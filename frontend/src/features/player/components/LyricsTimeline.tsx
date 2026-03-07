import { useRef, useEffect, useMemo } from 'react'
import { useLyricsSync } from '../hooks/use-lyrics-sync'
import { normalizeWords } from '../lib/normalize-words'
import type { LyricsSegment } from '@/types/song'

interface LyricsTimelineProps {
  segments: LyricsSegment[]
  onSeek?: (time: number) => void
}

export function LyricsTimeline({ segments, onSeek }: LyricsTimelineProps) {
  // Normalize segments so empty words arrays get synthesized timing,
  // enabling per-word highlighting even for older transcriptions.
  const normalizedSegments = useMemo(
    () => segments.map((s) => ({ ...s, words: normalizeWords(s) })),
    [segments]
  )

  const { activeSegmentIndex, activeWordIndex } = useLyricsSync(normalizedSegments)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (activeRef.current && scrollRef.current) {
      activeRef.current.scrollIntoView({
        behavior: 'auto',
        block: 'center',
      })
    }
  }, [activeSegmentIndex])

  if (!normalizedSegments.length) return null

  return (
    <div
      ref={scrollRef}
      className="max-h-48 overflow-y-auto space-y-2 text-sm scrollbar-hide"
      data-testid="lyrics-timeline"
    >
      {normalizedSegments.map((segment, si) => (
        <p
          key={si}
          className={
            si === activeSegmentIndex
              ? 'text-smoke-100'
              : 'text-smoke-600'
          }
        >
          {segment.words.map((word, wi) => (
            <span
              key={wi}
              ref={
                si === activeSegmentIndex && wi === activeWordIndex
                  ? activeRef
                  : undefined
              }
              className={
                si === activeSegmentIndex && wi === activeWordIndex
                  ? 'text-flame-400 font-semibold'
                  : ''
              }
              onClick={() => onSeek?.(word.start)}
              style={{ cursor: 'pointer' }}
              title={`${word.start.toFixed(2)}s – ${word.end.toFixed(2)}s`}
            >
              {word.word}
              <span className="text-[9px] text-smoke-600 font-mono align-super ml-px">
                {word.start.toFixed(2)}-{word.end.toFixed(2)}
              </span>{' '}
            </span>
          ))}
        </p>
      ))}
    </div>
  )
}
