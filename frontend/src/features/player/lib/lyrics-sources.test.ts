import { describe, it, expect } from 'vitest'
import { getAvailableLyricsSources } from './lyrics-sources'
import type { LyricsSegment, SongDetail } from '@/types/song'

function seg(start: number, end: number, text: string): LyricsSegment {
  return { start, end, text, words: [] }
}

const whisperSegs = [seg(0, 2, 'hello world'), seg(3, 5, 'second line')]
const quickSegs = [seg(0, 2, 'hello world quick')]
const hebrewSegs = [
  seg(0, 2, 'שלום עולם זהו שיר בדיקה ארוך'),
  seg(3, 5, 'שורה שניה עם עוד מילים בעברית'),
  seg(6, 8, 'והשורה השלישית ממשיכה את השיר'),
]

function makeDetail(overrides: Record<string, unknown>): SongDetail {
  return overrides as unknown as SongDetail
}

describe('getAvailableLyricsSources', () => {
  it('Auto prefers ver2 (whisper, verbatim) when both ver1 and ver2 exist', () => {
    const detail = makeDetail({
      ver1_lyrics: quickSegs,
      ver1_lyrics_source: 'lrclib_quick_synced',
      ver2_lyrics: whisperSegs,
      ver2_lyrics_source: 'whisper',
    })
    const options = getAvailableLyricsSources(detail, undefined)
    const auto = options.find((o) => o.key === 'auto')
    expect(auto).toBeDefined()
    expect(auto?.segments).toEqual(whisperSegs)
    expect(auto?.source).toBe('whisper')
  })

  it('Auto ignores legacy ver3 (LLM-merged) lyrics even when present in the response', () => {
    const detail = makeDetail({
      ver1_lyrics: quickSegs,
      ver1_lyrics_source: 'lrclib_quick_synced',
      ver2_lyrics: whisperSegs,
      ver2_lyrics_source: 'whisper',
      // Legacy cached response shape — must not be preferred or offered.
      ver3_lyrics: [seg(5, 2, 'corrupted merged line')],
      ver3_lyrics_source: 'llm_quick_words_regular_timing',
      corrected_lyrics: [seg(5, 2, 'corrupted merged line')],
      corrected_lyrics_source: 'llm_quick_words_regular_timing',
    })
    const options = getAvailableLyricsSources(detail, undefined)
    const auto = options.find((o) => o.key === 'auto')
    expect(auto?.segments).toEqual(whisperSegs)
    expect(options.some((o) => o.key === 'ver3')).toBe(false)
    expect(options.some((o) => o.label === 'Merged')).toBe(false)
  })

  it('Auto prefers ver1 (online) for non-Latin songs', () => {
    const detail = makeDetail({
      ver1_lyrics: hebrewSegs,
      ver1_lyrics_source: 'lrclib_quick_synced',
      ver2_lyrics: [seg(0, 2, 'garbled latin transcription')],
      ver2_lyrics_source: 'whisper',
    })
    const options = getAvailableLyricsSources(detail, undefined)
    const auto = options.find((o) => o.key === 'auto')
    expect(auto?.segments).toEqual(hebrewSegs)
  })

  it('always offers an Off option', () => {
    const options = getAvailableLyricsSources(makeDetail({}), undefined)
    expect(options.some((o) => o.key === 'off')).toBe(true)
  })
})
