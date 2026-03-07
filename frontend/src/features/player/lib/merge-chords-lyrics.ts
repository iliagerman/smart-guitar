import type { ChordEntry, LyricsSegment, LyricsWord } from '@/types/song'
import { detectTextDirection, type TextDirection } from '@/lib/text-direction'
import { normalizeWords } from './normalize-words'

export interface PositionedChord {
  chord: string
  start_time: number
  end_time: number
  charOffset: number
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

/**
 * Compute the character offset for a chord within a lyrics line.
 * Finds the word whose onset is nearest to the chord's start_time.
 * This handles inter-word gaps (where chord timing falls between words)
 * by snapping to the closest word rather than falling through to end-of-line.
 */
function computeCharOffset(chord: ChordEntry, words: LyricsWord[]): number {
  if (words.length === 0) return 0

  let bestOffset = 0
  let bestDist = Infinity
  let offset = 0

  for (const word of words) {
    const dist = Math.abs(chord.start_time - word.start)
    if (dist < bestDist) {
      bestDist = dist
      bestOffset = offset
    }
    offset += word.word.length + 1
  }

  return bestOffset
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

    // Use a tolerance window so chords near segment boundaries aren't missed.
    // IMPORTANT: attach chords based on interval overlap, not only chord start.
    // Otherwise a chord that starts slightly before the lyric segment but sustains
    // into it won't render above the lyric line.
    const segStart = segment.start - SEGMENT_TOLERANCE_S
    const segEnd = segment.end

    for (let ci = 0; ci < chords.length; ci++) {
      if (assignedChordIndices.has(ci)) continue
      const chord = chords[ci]
      if (chord.chord === 'N') continue
      const overlaps = chord.end_time > segStart && chord.start_time < segEnd
      if (overlaps) {
        assignedChordIndices.add(ci)
        segmentChords.push({
          chord: chord.chord,
          start_time: chord.start_time,
          end_time: chord.end_time,
          charOffset: computeCharOffset(chord, words),
        })
      }
    }

    lines.push({
      text: segment.text,
      words,
      chords: segmentChords,
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

    for (const [gap, gapChords] of chordsByGap.entries()) {
      if (gapChords.length < 3 && validLyrics.length > 0) {
        // Attach to adjacent lyric line
        const targetSegmentIndex = gap < validLyrics.length ? gap : gap - 1
        const targetLine = lines.find(l => l.segmentIndex === targetSegmentIndex)

        if (targetLine) {
          for (const chord of gapChords) {
            let offset = 0
            if (gap === targetSegmentIndex) {
              // Prepending to the next segment (offset 0 puts it on the first word)
              offset = 0
            } else {
              // Appending to the last segment (put it on the last word)
              offset = targetLine.words.length > 0
                ? targetLine.words.reduce((acc, w) => acc + w.word.length + 1, 0)
                : targetLine.text.length
            }

            targetLine.chords.push({
              chord: chord.chord,
              start_time: chord.start_time,
              end_time: chord.end_time,
              charOffset: offset,
            })
          }
          targetLine.chords.sort((a, b) => a.start_time - b.start_time)
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
