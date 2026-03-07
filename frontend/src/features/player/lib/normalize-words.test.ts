import { describe, it, expect } from 'vitest'
import { normalizeWords } from './normalize-words'
import type { LyricsSegment } from '@/types/song'

describe('normalizeWords', () => {
  it('returns existing words unchanged when they already tile the segment', () => {
    const segment: LyricsSegment = {
      start: 10,
      end: 14,
      text: 'hello world',
      words: [
        { word: 'hello', start: 10, end: 12 },
        { word: 'world', start: 12, end: 14 },
      ],
    }
    expect(normalizeWords(segment)).toEqual(segment.words)
  })

  it('synthesizes words from text when words array is empty', () => {
    const segment: LyricsSegment = {
      start: 10,
      end: 14,
      text: 'hello world',
      words: [],
    }
    const result = normalizeWords(segment)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ word: 'hello', start: 10, end: 12 })
    expect(result[1]).toEqual({ word: 'world', start: 12, end: 14 })
  })

  it('distributes timing evenly across multiple words', () => {
    const segment: LyricsSegment = {
      start: 0,
      end: 9,
      text: 'one two three',
      words: [],
    }
    const result = normalizeWords(segment)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ word: 'one', start: 0, end: 3 })
    expect(result[1]).toEqual({ word: 'two', start: 3, end: 6 })
    expect(result[2]).toEqual({ word: 'three', start: 6, end: 9 })
  })

  it('pins last word end to segment end to avoid float drift', () => {
    const segment: LyricsSegment = {
      start: 54.22,
      end: 59.76,
      text: 'On a dark desert highway cool wind in my hair',
      words: [],
    }
    const result = normalizeWords(segment)

    expect(result[result.length - 1].end).toBe(59.76)
  })

  it('returns empty array when text is empty', () => {
    const segment: LyricsSegment = {
      start: 0,
      end: 5,
      text: '',
      words: [],
    }
    expect(normalizeWords(segment)).toEqual([])
  })

  it('returns empty array when text is only whitespace', () => {
    const segment: LyricsSegment = {
      start: 0,
      end: 5,
      text: '   ',
      words: [],
    }
    expect(normalizeWords(segment)).toEqual([])
  })

  it('produces contiguous non-overlapping time ranges', () => {
    const segment: LyricsSegment = {
      start: 14.06,
      end: 29.02,
      text: "I heard that you're settled down that you found a girl",
      words: [],
    }
    const result = normalizeWords(segment)

    // Every word should have start < end
    for (const w of result) {
      expect(w.start).toBeLessThan(w.end)
    }

    // Words should be contiguous
    for (let i = 1; i < result.length; i++) {
      expect(result[i].start).toBeCloseTo(result[i - 1].end, 10)
    }

    // Should span the full segment
    expect(result[0].start).toBe(14.06)
    expect(result[result.length - 1].end).toBe(29.02)
  })

  it('handles single-word text', () => {
    const segment: LyricsSegment = {
      start: 5,
      end: 8,
      text: 'Welcome',
      words: [],
    }
    const result = normalizeWords(segment)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ word: 'Welcome', start: 5, end: 8 })
  })

  it('expands isolated zero-width word and resolves overlap with next word', () => {
    // Matches actual Hotel California segment 0: only "On" is zero-width
    const segment: LyricsSegment = {
      start: 54.68,
      end: 56.1,
      text: 'On a dark desert highway',
      words: [
        { word: 'On', start: 54.68, end: 54.68 },
        { word: 'a', start: 54.68, end: 54.82 },
        { word: 'dark', start: 54.82, end: 55.28 },
        { word: 'desert', start: 55.28, end: 55.6 },
        { word: 'highway', start: 55.6, end: 56.1 },
      ],
    }
    const result = normalizeWords(segment)

    // "On" gets a 20ms sliver before "a", which starts after it
    expect(result[0].word).toBe('On')
    expect(result[0].start).toBe(54.68)
    expect(result[0].end).toBeCloseTo(54.70, 2)
    // "a" starts where "On" ends
    expect(result[1].word).toBe('a')
    expect(result[1].start).toBeCloseTo(54.70, 2)
    expect(result[1].end).toBe(54.82)
    // Later words unchanged
    expect(result[4].word).toBe('highway')
    expect(result[4].end).toBe(56.1)
  })

  it('distributes consecutive zero-width words with same start evenly', () => {
    // Matches actual Hotel California segment 69: 4/5 words zero-width at same time
    const segment: LyricsSegment = {
      start: 268.68,
      end: 269.08,
      text: 'We are programmed to receive',
      words: [
        { word: 'We', start: 268.68, end: 268.68 },
        { word: 'are', start: 268.68, end: 268.68 },
        { word: 'programmed', start: 268.68, end: 268.68 },
        { word: 'to', start: 268.68, end: 268.68 },
        { word: 'receive', start: 268.68, end: 269.08 },
      ],
    }
    const result = normalizeWords(segment)

    expect(result).toHaveLength(5)
    // All words should have positive duration
    for (const w of result) {
      expect(w.end).toBeGreaterThan(w.start)
    }
    // Gapless: each word's end === next word's start
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].end).toBeCloseTo(result[i + 1].start, 10)
    }
    // Spans full segment
    expect(result[0].start).toBe(268.68)
    expect(result[result.length - 1].end).toBe(269.08)
    // "receive" should get the bulk of the time
    expect(result[4].word).toBe('receive')
    expect(result[4].end - result[4].start).toBeGreaterThan(0.3)
  })

  it('expands zero-width words with different start times and caps extension', () => {
    const segment: LyricsSegment = {
      start: 54.22,
      end: 59.76,
      text: 'On a dark',
      words: [
        { word: 'On', start: 54.68, end: 54.68 },
        { word: 'a', start: 55.12, end: 55.12 },
        { word: 'dark', start: 56.0, end: 56.0 },
      ],
    }
    const result = normalizeWords(segment)

    // First word extended back by MAX_EXTEND_S (0.3), not all the way to segment start
    // since gap (54.68 - 54.22 = 0.46) > 0.3
    expect(result[0].word).toBe('On')
    expect(result[0].start).toBeCloseTo(54.38, 2) // 54.68 - 0.3
    expect(result[1]).toEqual({ word: 'a', start: 55.12, end: 56.0 })
    // Last word: Phase 1 zero-width expansion already extended it to segment.end
    // (since it's the last zero-width word), so no Phase 4 extension needed
    expect(result[2].word).toBe('dark')
    expect(result[2].start).toBe(56.0)
    expect(result[2].end).toBe(59.76)
  })

  it('fills gap between valid and zero-width word at midpoint', () => {
    const segment: LyricsSegment = {
      start: 10,
      end: 15,
      text: 'hello world',
      words: [
        { word: 'hello', start: 10, end: 12 },
        { word: 'world', start: 13, end: 13 },
      ],
    }
    const result = normalizeWords(segment)

    // Gap from 12 to 13 split at 70/30 bias: 12 + 1 * 0.7 = 12.7
    expect(result[0]).toEqual({ word: 'hello', start: 10, end: 12.7 })
    // world expands to segment end, starts at gap split point
    expect(result[1]).toEqual({ word: 'world', start: 12.7, end: 15 })
  })

  it('fills gaps and caps extension to segment boundaries for mixed words', () => {
    const segment: LyricsSegment = {
      start: 0,
      end: 10,
      text: 'one two three',
      words: [
        { word: 'one', start: 0, end: 3 },
        { word: 'two', start: 4, end: 4 },
        { word: 'three', start: 6, end: 9 },
      ],
    }
    const result = normalizeWords(segment)

    // Gap between one(end=3) and two(start=4 after expansion) split at 70/30 bias
    expect(result[0].word).toBe('one')
    expect(result[0].start).toBe(0)
    expect(result[0].end).toBeCloseTo(3.7, 10)
    // two expanded from zero-width to fill gap to three, starts at split point
    expect(result[1].word).toBe('two')
    expect(result[1].start).toBeCloseTo(3.7, 10)
    expect(result[1].end).toBe(6)
    // three: gap to segment.end is 1.0s > MAX_EXTEND_S (0.3), so only extends by 0.3
    expect(result[2].word).toBe('three')
    expect(result[2].start).toBe(6)
    expect(result[2].end).toBe(9.3) // 9 + 0.3
  })

  it('produces gapless coverage for real-world data with gaps and zero-width words', () => {
    // Real data from Knockin' on Heaven's Door: gaps between words + zero-width
    const segment: LyricsSegment = {
      start: 56.88,
      end: 61.3,
      text: "Knock, knock, knocking on heaven's door.",
      words: [
        { word: 'Knock', start: 56.88, end: 58.28 },
        { word: 'knock', start: 58.54, end: 58.54 },
        { word: 'knocking', start: 59.08, end: 59.08 },
        { word: 'on', start: 59.08, end: 59.68 },
        { word: "heaven's", start: 59.68, end: 60.56 },
        { word: 'door', start: 60.56, end: 61.3 },
      ],
    }
    const result = normalizeWords(segment)

    // Gapless invariant
    expect(result[0].start).toBe(56.88)
    expect(result[result.length - 1].end).toBe(61.3)
    for (const w of result) {
      expect(w.end).toBeGreaterThan(w.start)
    }
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].end).toBeCloseTo(result[i + 1].start, 10)
    }
  })

  it('caps extension for segment with leading gap before first word', () => {
    // Real pattern: segment.start is earlier than first word's start
    const segment: LyricsSegment = {
      start: 50.72,
      end: 53.88,
      text: "I feel I'm knocking on heaven's door.",
      words: [
        { word: 'feel', start: 51.16, end: 51.16 },
        { word: "I'm", start: 51.16, end: 52.14 },
        { word: 'knocking', start: 52.14, end: 52.14 },
        { word: 'on', start: 52.14, end: 52.78 },
        { word: "heaven's", start: 52.78, end: 53.54 },
        { word: 'door', start: 53.54, end: 53.88 },
      ],
    }
    const result = normalizeWords(segment)

    // First word extended back by MAX_EXTEND_S (0.3), not all the way to segment.start
    // since gap (51.16 - 50.72 = 0.44) > 0.3
    expect(result[0].start).toBeCloseTo(50.86, 2) // 51.16 - 0.3
    // Last word ends at segment end (gap is 0, no extension needed)
    expect(result[result.length - 1].end).toBe(53.88)
    // All contiguous
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].end).toBeCloseTo(result[i + 1].start, 10)
    }
    for (const w of result) {
      expect(w.end).toBeGreaterThan(w.start)
    }
  })
})
