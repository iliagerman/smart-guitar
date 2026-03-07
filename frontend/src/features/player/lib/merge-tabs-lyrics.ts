import type { LyricsSegment, LyricsWord, TabNote } from '@/types/song'
import { detectTextDirection, type TextDirection } from '@/lib/text-direction'
import { normalizeWords } from './normalize-words'

export interface PositionedTabNote extends TabNote {
  charOffset: number
}

export interface TabsSheetLine {
  text: string
  words: LyricsWord[]
  notes: PositionedTabNote[]
  startTime: number
  endTime: number
  segmentIndex: number
  direction: TextDirection
}

const URL_PATTERN = /^https?:\/\//

function isValidLyricsSegment(segment: LyricsSegment): boolean {
  if (!segment.text || segment.text.trim().length === 0) return false
  if (URL_PATTERN.test(segment.text.trim())) return false
  return true
}

function computeCharOffset(
  note: TabNote,
  words: LyricsWord[],
  segment: { start: number; end: number; text: string }
): number {
  // Prefer word-based alignment (matches ChordSheet behavior)
  if (words.length > 0) {
    let offset = 0
    for (const word of words) {
      if (note.start_time >= word.start && note.start_time < word.end) {
        const wordDuration = Math.max(0.001, word.end - word.start)
        const within = (note.start_time - word.start) / wordDuration
        const local = Math.max(
          0,
          Math.min(word.word.length - 1, Math.floor(within * Math.max(1, word.word.length - 1)))
        )
        return offset + local
      }
      offset += word.word.length + 1
    }
    return offset
  }

  // Fallback: proportional mapping across the segment text.
  const len = Math.max(1, (segment.text || '').length)
  const duration = Math.max(0.001, segment.end - segment.start)
  const ratio = (note.start_time - segment.start) / duration
  return Math.max(0, Math.min(len - 1, Math.floor(ratio * len)))
}

function getLineDirection(segment: LyricsSegment, words: LyricsWord[]): TextDirection {
  const sample = segment.text || words.slice(0, 6).map((w) => w.word).join(' ')
  return detectTextDirection(sample)
}

/**
 * Merge tab notes and lyrics data into a unified tab-sheet representation.
 *
 * - Filters out garbage lyrics segments (URLs, empty text)
 * - Synthesizes word timing when words array is empty
 * - Groups unassigned notes into instrumental lines
 * - Output is sorted by startTime
 */
export function mergeTabsLyrics(tabs: TabNote[], lyrics: LyricsSegment[]): TabsSheetLine[] {
  const lines: TabsSheetLine[] = []
  const assignedNoteIndices = new Set<number>()

  const validLyrics = lyrics.filter(isValidLyricsSegment)

  // For each valid lyrics segment, collect overlapping notes
  for (let si = 0; si < validLyrics.length; si++) {
    const segment = validLyrics[si]
    const words = normalizeWords(segment)
    const direction = getLineDirection(segment, words)

    const segmentNotes: PositionedTabNote[] = []
    for (let ni = 0; ni < tabs.length; ni++) {
      const note = tabs[ni]
      if (note.start_time >= segment.start && note.start_time < segment.end) {
        assignedNoteIndices.add(ni)
        segmentNotes.push({
          ...note,
          charOffset: computeCharOffset(note, words, segment),
        })
      }
    }

    lines.push({
      text: segment.text,
      words,
      notes: segmentNotes,
      startTime: segment.start,
      endTime: segment.end,
      segmentIndex: si,
      direction,
    })
  }

  // Collect unassigned notes into instrumental lines
  const unassigned: TabNote[] = []
  for (let ni = 0; ni < tabs.length; ni++) {
    if (!assignedNoteIndices.has(ni)) unassigned.push(tabs[ni])
  }

  if (unassigned.length > 0) {
    let groupStart = unassigned[0].start_time
    let groupNotes: PositionedTabNote[] = [{ ...unassigned[0], charOffset: 0 }]

    for (let i = 1; i < unassigned.length; i++) {
      const prev = unassigned[i - 1]
      const curr = unassigned[i]

      const prevGap = findGap(prev.start_time, validLyrics)
      const currGap = findGap(curr.start_time, validLyrics)

      if (prevGap !== currGap) {
        lines.push({
          text: '',
          words: [],
          notes: groupNotes,
          startTime: groupStart,
          endTime: prev.end_time,
          segmentIndex: -1,
          direction: 'ltr',
        })
        groupStart = curr.start_time
        groupNotes = []
      }

      // Space notes out in instrumental rows so multi-digit frets don't overlap too badly.
      const offset = groupNotes.reduce((acc, n) => acc + String(n.fret).length + 2, 0)
      groupNotes.push({ ...curr, charOffset: offset })
    }

    lines.push({
      text: '',
      words: [],
      notes: groupNotes,
      startTime: groupStart,
      endTime: unassigned[unassigned.length - 1].end_time,
      segmentIndex: -1,
      direction: 'ltr',
    })
  }

  lines.sort((a, b) => a.startTime - b.startTime)

  // Post-process: split lines that are too long to prevent horizontal scrolling
  const splitLines: TabsSheetLine[] = []
  for (const line of lines) {
    if (line.segmentIndex === -1) {
      // Instrumental line: split by number of notes (e.g., max 16 notes per line)
      const MAX_NOTES = 16
      if (line.notes.length <= MAX_NOTES) {
        splitLines.push(line)
      } else {
        for (let i = 0; i < line.notes.length; i += MAX_NOTES) {
          const chunkNotes = line.notes.slice(i, i + MAX_NOTES)
          splitLines.push({
            ...line,
            notes: chunkNotes,
            startTime: chunkNotes[0].start_time,
            endTime: chunkNotes[chunkNotes.length - 1].end_time,
          })
        }
      }
    } else {
      // Lyrics line: split by words, but also ensure we don't have too many notes per line
      const MAX_WORDS = 8
      const MAX_NOTES = 16

      let currentWords: typeof line.words = []
      let currentNotes: typeof line.notes = []
      let lastChunkEndTime = line.startTime

      for (let i = 0; i < line.words.length; i++) {
        const word = line.words[i]
        const isLastWord = i === line.words.length - 1
        const nextWordStart = isLastWord ? line.endTime : line.words[i + 1].start

        // Notes that belong to this word (from lastChunkEndTime if first word in chunk, else previous word's end)
        const wordStartTime = currentWords.length === 0 ? lastChunkEndTime : currentWords[currentWords.length - 1].end
        const wordEndTime = isLastWord ? line.endTime : nextWordStart

        const wordNotes = line.notes.filter(n => n.start_time >= wordStartTime && n.start_time < wordEndTime)

        if (currentWords.length > 0 && (currentWords.length >= MAX_WORDS || currentNotes.length + wordNotes.length > MAX_NOTES)) {
          // Push current chunk
          splitLines.push({
            ...line,
            text: currentWords.map((w) => w.word).join(' '),
            words: currentWords,
            notes: currentNotes,
            startTime: lastChunkEndTime,
            endTime: currentWords[currentWords.length - 1].end,
          })
          lastChunkEndTime = currentWords[currentWords.length - 1].end
          currentWords = []
          currentNotes = []
        }

        currentWords.push(word)
        currentNotes.push(...wordNotes)
      }

      if (currentWords.length > 0) {
        splitLines.push({
          ...line,
          text: currentWords.map((w) => w.word).join(' '),
          words: currentWords,
          notes: currentNotes,
          startTime: lastChunkEndTime,
          endTime: line.endTime,
        })
      }
    }
  }

  return splitLines
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
