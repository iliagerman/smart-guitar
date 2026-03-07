import type { LyricsSegment, LyricsWord } from '@/types/song'

/**
 * Ensure a segment has word-level timing data that tiles the full segment
 * interval [segment.start, segment.end] with no gaps and no overlaps.
 *
 * When the words array is empty (e.g. older transcriptions that lack
 * word-level timestamps), synthesizes words from the segment text with
 * evenly distributed timestamps across [segment.start, segment.end].
 *
 * When words exist but have zero-width timestamps (start === end, common
 * with Whisper), expands each word so it occupies a real time range.
 *
 * After fixing zero-width words, resolves any overlaps, fills inter-word
 * gaps at the midpoint, and extends the first/last word to the segment
 * boundaries so every moment within the segment maps to exactly one word.
 */
export function normalizeWords(segment: LyricsSegment): LyricsWord[] {
  if (segment.words.length === 0) {
    const parts = segment.text.split(/\s+/).filter(Boolean)
    if (parts.length === 0) return []

    const duration = segment.end - segment.start
    const wordDuration = duration / parts.length

    return parts.map((word, i) => ({
      word,
      start: segment.start + i * wordDuration,
      end: i === parts.length - 1 ? segment.end : segment.start + (i + 1) * wordDuration,
    }))
  }

  // --- Phase 1: Expand zero-width words (start >= end) ---
  // The UI samples time discretely (~60Hz), so a truly instantaneous word
  // (start === end) can be missed entirely. Give such words a small minimum
  // duration. When consecutive zero-width words share the same start time,
  // distribute them across the gap to the next distinct timestamp.
  const MIN_ZERO_WIDTH_S = 0.06
  const hasZeroWidth = segment.words.some((w) => w.start >= w.end)
  const phase1: LyricsWord[] = []

  if (hasZeroWidth) {
    const words = segment.words
    let i = 0
    while (i < words.length) {
      const w = words[i]

      if (w.start < w.end) {
        phase1.push({ ...w })
        i++
        continue
      }

      // Collect consecutive zero-width words starting at the same time
      const groupStart = w.start
      const groupBegin = i
      while (i < words.length && words[i].start >= words[i].end && words[i].start === groupStart) {
        i++
      }

      const minEnd = groupStart + MIN_ZERO_WIDTH_S
      const groupEnd = i < words.length ? Math.max(words[i].start, minEnd) : Math.max(segment.end, minEnd)
      const groupSize = i - groupBegin
      const sliceDuration = (groupEnd - groupStart) / groupSize

      for (let j = 0; j < groupSize; j++) {
        phase1.push({
          ...words[groupBegin + j],
          start: groupStart + j * sliceDuration,
          end: j === groupSize - 1 ? groupEnd : groupStart + (j + 1) * sliceDuration,
        })
      }
    }
  } else {
    for (const w of segment.words) {
      phase1.push({ ...w })
    }
  }

  // --- Phase 2: Resolve overlaps ---
  // When expanded zero-width words overlap the next word, clamp the earlier
  // word's end. If this makes it zero-width, give it a 20ms sliver and push
  // the next word's start forward.
  const MIN_SLIVER_S = 0.02
  for (let i = 0; i < phase1.length - 1; i++) {
    if (phase1[i].end > phase1[i + 1].start) {
      phase1[i].end = phase1[i + 1].start
    }
    if (phase1[i].start >= phase1[i].end) {
      phase1[i].end = phase1[i].start + MIN_SLIVER_S
      if (phase1[i].end > phase1[i + 1].start) {
        phase1[i + 1].start = phase1[i].end
      }
    }
  }
  // Handle last word if degenerate
  const last = phase1[phase1.length - 1]
  if (last.start >= last.end) {
    last.end = Math.max(last.start + MIN_SLIVER_S, segment.end)
  }

  // --- Phase 3: Fill inter-word gaps with 70/30 bias ---
  // The previous word "owns" 70% of the silence gap and the next word gets
  // 30%.  In natural speech/singing, listeners attribute the trailing silence
  // to the preceding word (forward masking), so the highlight should linger
  // on the previous word and transition to the next word slightly early.
  for (let i = 0; i < phase1.length - 1; i++) {
    const gap = phase1[i + 1].start - phase1[i].end
    if (gap > 0) {
      const splitPoint = phase1[i].end + gap * 0.7
      phase1[i].end = splitPoint
      phase1[i + 1].start = splitPoint
    }
  }

  // --- Phase 4: Extend to segment boundaries (capped) ---
  // Only extend up to MAX_EXTEND_S so words don't absorb long instrumental
  // intros/outros within a line. Large gaps stay unhighlighted.
  const MAX_EXTEND_S = 0.3
  const firstGap = phase1[0].start - segment.start
  if (firstGap > 0 && firstGap <= MAX_EXTEND_S) {
    phase1[0].start = segment.start
  } else if (firstGap > MAX_EXTEND_S) {
    phase1[0].start = phase1[0].start - MAX_EXTEND_S
  }
  const lastGap = segment.end - phase1[phase1.length - 1].end
  if (lastGap > 0 && lastGap <= MAX_EXTEND_S) {
    phase1[phase1.length - 1].end = segment.end
  } else if (lastGap > MAX_EXTEND_S) {
    phase1[phase1.length - 1].end = phase1[phase1.length - 1].end + MAX_EXTEND_S
  }

  // Debug logging — enabled via localStorage (toggle with Ctrl+Shift+D)
  if (
    typeof window !== 'undefined' &&
    localStorage.getItem('lyrics-debug-enabled') === 'true'
  ) {
    const DRIFT_THRESHOLD = 0.05
    const shifted = segment.words.filter((orig, i) => {
      const norm = phase1[i]
      return (
        norm &&
        (Math.abs(orig.start - norm.start) > DRIFT_THRESHOLD ||
          Math.abs(orig.end - norm.end) > DRIFT_THRESHOLD)
      )
    })
    if (shifted.length > 0) {
      console.debug(
        '[normalize-words] adjusted',
        shifted.length,
        'words in segment:',
        segment.text.slice(0, 40),
      )
    }
  }

  return phase1
}
