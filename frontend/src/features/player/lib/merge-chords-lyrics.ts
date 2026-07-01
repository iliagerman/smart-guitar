import type { ChordEntry, LyricsSegment, LyricsWord } from '@/types/song'
import { detectTextDirection, type TextDirection } from '@/lib/text-direction'
import { normalizeWords } from './normalize-words'

export interface PositionedChord {
  chord: string
  start_time: number
  end_time: number
  charOffset: number
  bass?: string | null
}

export interface ChordSheetLine {
  text: string
  words: LyricsWord[]
  chords: PositionedChord[]
  startTime: number
  endTime: number
  segmentIndex: number
  direction: TextDirection
}

const URL_PATTERN = /^https?:\/\//

/**
 * Tolerance (seconds) for matching a chord to a lyrics segment boundary.
 * Chords and lyrics come from independent ML models (autochord vs Whisper)
 * with inherent timing imprecision, so a small tolerance prevents chords
 * near segment boundaries from being misassigned.
 */
const SEGMENT_TOLERANCE_S = 0.3

/**
 * Filter out garbage lyrics segments (URLs, empty text, etc.)
 */
function isValidLyricsSegment(segment: LyricsSegment): boolean {
  if (!segment.text || segment.text.trim().length === 0) return false
  if (URL_PATTERN.test(segment.text.trim())) return false
  return true
}


/** Character offset of the start of each word (one entry per word). */
function getWordStartOffsets(words: LyricsWord[]): number[] {
  let offset = 0
  return words.map((word) => {
    const current = offset
    offset += word.word.length + 1
    return current
  })
}

/**
 * The word column a chord naturally belongs to: the first word still playing or
 * upcoming at the chord's start time. Chords in inter-word gaps attach to the
 * upcoming word, keeping successive chord changes visually separated.
 */
function naturalColumn(chordStart: number, words: LyricsWord[]): number {
  for (let i = 0; i < words.length; i++) {
    if (chordStart < words[i].end) return i
  }
  return words.length - 1
}

/**
 * Assign each chord to the lyric word whose timing contains the chord start.
 * Multiple chord changes inside the same word intentionally stack in that word's
 * column; spreading them onto later words makes the highlighted chord appear
 * offset from the lyric timing.
 *
 * Mutates and returns `chords`, sorted by start_time.
 */
function assignChordColumns(chords: PositionedChord[], words: LyricsWord[]): PositionedChord[] {
  chords.sort((a, b) => a.start_time - b.start_time)

  if (words.length === 0) {
    // Instrumental-style line: lay chords out sequentially by label width.
    let offset = 0
    for (const chord of chords) {
      chord.charOffset = offset
      offset += chord.chord.length + 2
    }
    return chords
  }

  const offsets = getWordStartOffsets(words)
  for (const chord of chords) {
    chord.charOffset = offsets[naturalColumn(chord.start_time, words)]
  }

  return chords
}

/**
 * Index of the chord that should be highlighted at `time`: the latest chord
 * whose start time is at or before `time`. Returns -1 before the first chord.
 *
 * Selecting by "most recently started" (rather than strict interval
 * containment) makes the highlight advance monotonically with playback,
 * keeps it on the current chord during gaps between chords, and picks the
 * latest-started chord when intervals overlap. Assumes `chords` is sorted by
 * start_time (as produced by `assignChordColumns`).
 */
export function findActiveChordIndex(
  chords: { start_time: number }[],
  time: number,
): number {
  for (let i = chords.length - 1; i >= 0; i--) {
    if (time >= chords[i].start_time) return i
  }
  return -1
}

function getLineDirection(segment: LyricsSegment, words: LyricsWord[]): TextDirection {
  // Prefer the explicit segment text; fall back to the first couple of words.
  const sample = segment.text || words.slice(0, 6).map((w) => w.word).join(' ')
  return detectTextDirection(sample)
}

/**
 * Merge chord and lyrics data into a unified chord-sheet representation.
 *
 * - Filters out garbage lyrics segments (URLs, empty text)
 * - Synthesizes word timing when words array is empty
 * - Groups unassigned chords into instrumental lines
 * - Output is sorted by startTime
 */
export function mergeChordLyrics(
  chords: ChordEntry[],
  lyrics: LyricsSegment[]
): ChordSheetLine[] {
  const lines: ChordSheetLine[] = []
  const assignedChordIndices = new Set<number>()

  const validLyrics = lyrics.filter(isValidLyricsSegment)

  // For each valid lyrics segment, collect overlapping chords
  for (let si = 0; si < validLyrics.length; si++) {
    const segment = validLyrics[si]
    const words = normalizeWords(segment)
    const direction = getLineDirection(segment, words)
    const segmentChords: PositionedChord[] = []

    // Don't pull previous chords into the lyric line. Autochord intervals can
    // overlap heavily; if all carry-over chords are attached here they get
    // spread across the lyric words and the active chord appears offset. Keep at
    // most the latest chord that was already sustaining at the lyric start.
    const segStart = segment.start - SEGMENT_TOLERANCE_S
    const segEnd = segment.end
    let carryInChordIndex = -1
    let carryInStart = -Infinity
    for (let ci = 0; ci < chords.length; ci++) {
      const chord = chords[ci]
      if (assignedChordIndices.has(ci) || chord.chord === 'N') continue
      if (chord.start_time < segStart && chord.end_time > segment.start && chord.start_time > carryInStart) {
        carryInChordIndex = ci
        carryInStart = chord.start_time
      }
    }

    for (let ci = 0; ci < chords.length; ci++) {
      if (assignedChordIndices.has(ci)) continue
      const chord = chords[ci]
      if (chord.chord === 'N') continue
      const startsInSegment = chord.start_time >= segment.start && chord.start_time < segEnd
      if (startsInSegment || ci === carryInChordIndex) {
        assignedChordIndices.add(ci)
        segmentChords.push({
          chord: chord.chord,
          start_time: chord.start_time,
          end_time: chord.end_time,
          bass: chord.bass,
          charOffset: 0, // assigned by assignChordColumns below
        })
      }
    }

    lines.push({
      text: segment.text,
      words,
      chords: assignChordColumns(segmentChords, words),
      startTime: segment.start,
      endTime: segment.end,
      segmentIndex: si,
      direction,
    })
  }

  // Collect unassigned chords (excluding 'N') into instrumental lines
  const unassignedChords: ChordEntry[] = []
  for (let ci = 0; ci < chords.length; ci++) {
    if (!assignedChordIndices.has(ci) && chords[ci].chord !== 'N') {
      unassignedChords.push(chords[ci])
    }
  }

  if (unassignedChords.length > 0) {
    // Group unassigned chords by gap
    const chordsByGap = new Map<number, ChordEntry[]>()
    for (const chord of unassignedChords) {
      let gap = findGap(chord.start_time, validLyrics)
      if (gap === -1) {
        // Chord time falls within a segment range but wasn't assigned in the
        // first pass (e.g. tolerance already captured it, or it's an 'N' chord
        // that was filtered). Find the nearest gap index (not segment index).
        let bestGap = 0
        let minDiff = Infinity
        for (let i = 0; i < validLyrics.length; i++) {
          const distToStart = Math.abs(chord.start_time - validLyrics[i].start)
          const distToEnd = Math.abs(chord.start_time - validLyrics[i].end)
          if (distToStart < minDiff) {
            minDiff = distToStart
            bestGap = i // gap before this segment
          }
          if (distToEnd < minDiff) {
            minDiff = distToEnd
            bestGap = i + 1 // gap after this segment
          }
        }
        gap = bestGap
      }
      if (!chordsByGap.has(gap)) chordsByGap.set(gap, [])
      chordsByGap.get(gap)!.push(chord)
    }

    const lineBySegmentIndex = new Map<number, (typeof lines)[number]>()
    for (const line of lines) {
      if (!lineBySegmentIndex.has(line.segmentIndex)) {
        lineBySegmentIndex.set(line.segmentIndex, line)
      }
    }
    for (const [gap, gapChords] of chordsByGap.entries()) {
      if (gapChords.length < 3 && validLyrics.length > 0) {
        // Attach to adjacent lyric line
        const targetSegmentIndex = gap < validLyrics.length ? gap : gap - 1
        const targetLine = lineBySegmentIndex.get(targetSegmentIndex)

        if (targetLine) {
          for (const chord of gapChords) {
            targetLine.chords.push({
              chord: chord.chord,
              start_time: chord.start_time,
              end_time: chord.end_time,
              bass: chord.bass,
              charOffset: 0, // reassigned by assignChordColumns below
            })
          }
          // Re-lay out the whole line so the merged-in chords stay in time order
          // and don't collide with the line's own chords.
          assignChordColumns(targetLine.chords, targetLine.words)
          // IMPORTANT: do NOT expand lyric line time bounds based on chords.
          // Highlight sync should be driven strictly by lyrics.json timestamps.
        }
      } else {
        // Create instrumental line
        const groupStart = gapChords[0].start_time
        const positionedChords: PositionedChord[] = []
        let currentOffset = 0
        for (const chord of gapChords) {
          positionedChords.push({
            chord: chord.chord,
            start_time: chord.start_time,
            end_time: chord.end_time,
            bass: chord.bass,
            charOffset: currentOffset,
          })
          currentOffset += chord.chord.length + 2
        }
        lines.push({
          text: '',
          words: [],
          chords: positionedChords,
          startTime: groupStart,
          endTime: gapChords[gapChords.length - 1].end_time,
          segmentIndex: -1,
          direction: 'ltr',
        })
      }
    }
  }

  lines.sort((a, b) => a.startTime - b.startTime)

  return lines
}

function findGap(time: number, lyrics: LyricsSegment[]): number {
  if (lyrics.length === 0) return 0
  if (time < lyrics[0].start) return 0
  for (let i = 0; i < lyrics.length - 1; i++) {
    if (time >= lyrics[i].end && time < lyrics[i + 1].start) {
      return i + 1
    }
  }
  if (time >= lyrics[lyrics.length - 1].end) return lyrics.length
  return -1
}
