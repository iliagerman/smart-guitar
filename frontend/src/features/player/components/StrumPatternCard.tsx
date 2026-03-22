import { useRef, useEffect, useState } from 'react'
import { ExternalLink, Loader2, Play, Square } from 'lucide-react'

import { cn } from '@/lib/cn'
import type { SectionStrumPattern } from '../lib/strum-pattern'
import { useStrumPlayback } from '../hooks/use-strum-playback'

/**
 * Generate beat labels for a strum pattern based on its length.
 */
function beatLabels(patternLength: number): string[] {
  if (patternLength <= 4) {
    return Array.from({ length: patternLength }, (_, i) => String(i + 1))
  }
  if (patternLength <= 8) {
    const labels: string[] = []
    for (let i = 0; i < patternLength; i++) {
      labels.push(i % 2 === 0 ? String(Math.floor(i / 2) + 1) : '&')
    }
    return labels
  }
  const subdivLabels = ['', 'e', '&', 'a']
  const labels: string[] = []
  for (let i = 0; i < patternLength; i++) {
    const beat = Math.floor(i / 4) + 1
    const sub = i % 4
    labels.push(sub === 0 ? String(beat) : subdivLabels[sub])
  }
  return labels
}


interface StrumPatternCardProps {
  sectionPatterns: SectionStrumPattern[]
  bpm: number
  strumNotes?: string | null
  tutorialUrl?: string | null
  loading?: boolean
  onOpenTutorial?: () => void
}

export function StrumPatternCard({ sectionPatterns, bpm, strumNotes, tutorialUrl, loading, onOpenTutorial }: StrumPatternCardProps) {
  const [playingSection, setPlayingSection] = useState<string | null>(null)

  if (sectionPatterns.length === 0 && !loading) return null

  return (
    <>
      <div className="rounded-lg border border-charcoal-700 bg-charcoal-900/40 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-smoke-100">Strumming Pattern</div>
          <div className="flex items-center gap-3">
            {tutorialUrl && onOpenTutorial && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenTutorial() }}
                className="flex items-center gap-1 text-[11px] text-flame-400 hover:text-flame-300 transition-colors cursor-pointer"
              >
                <ExternalLink size={11} />
                Learn to play
              </button>
            )}
          </div>
        </div>

        {loading && sectionPatterns.length === 0 ? (
          <div className="flex items-center gap-2 py-3 justify-center text-smoke-500 text-xs">
            <Loader2 size={14} className="animate-spin" />
            Loading strumming patterns...
          </div>
        ) : (
          sectionPatterns.map((sp) => (
            <SectionPattern
              key={sp.name}
              section={sp}
              bpm={bpm}
              disabled={playingSection !== null && playingSection !== sp.name}
              onPlayingChange={(playing) => setPlayingSection(playing ? sp.name : null)}
            />
          ))
        )}

        {strumNotes && (
          <div className="text-[11px] text-smoke-500 leading-relaxed border-t border-charcoal-700 pt-2">
            {strumNotes}
          </div>
        )}

      </div>

    </>
  )
}

function SectionPattern({ section, bpm, disabled, onPlayingChange }: {
  section: SectionStrumPattern
  bpm: number
  disabled?: boolean
  onPlayingChange?: (playing: boolean) => void
}) {
  const rawPattern = section.pattern.map((s) => s.direction)
  const { isPlaying, currentBeatIndex, toggle } = useStrumPlayback(rawPattern, bpm)
  const labels = beatLabels(rawPattern.length)

  // Notify parent when playing state changes
  const prevPlaying = useRef(false)
  useEffect(() => {
    if (prevPlaying.current !== isPlaying) {
      prevPlaying.current = isPlaying
      onPlayingChange?.(isPlaying)
    }
  }, [isPlaying, onPlayingChange])

  return (
    <div>
      {/* Section header with play button */}
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={toggle}
          disabled={disabled}
          className={cn(
            'flex items-center justify-center w-6 h-6 rounded-full transition-colors',
            isPlaying
              ? 'bg-flame-400/30 text-flame-300 hover:bg-flame-400/40'
              : disabled
                ? 'bg-charcoal-800 text-smoke-600 cursor-not-allowed'
                : 'bg-charcoal-700 text-smoke-300 hover:bg-charcoal-600 hover:text-smoke-100',
          )}
          title={isPlaying ? 'Stop' : disabled ? 'Stop current pattern first' : 'Play pattern'}
          aria-label={isPlaying ? 'Stop pattern' : 'Play pattern'}
        >
          {isPlaying ? <Square size={10} /> : <Play size={10} className="ml-0.5" />}
        </button>
        <span className="text-xs text-smoke-400">{section.name}</span>
        <span className="text-[10px] text-smoke-600 ml-auto">{bpm} bpm</span>
      </div>

      {/* Strum arrows with beat labels — wraps on overflow */}
      <div className="flex flex-wrap gap-0.5 items-end">
        {section.pattern.map((step, index) => {
          const isDown = step.direction === 'down'
          const isActive = isPlaying && currentBeatIndex === index
          const label = labels[index] ?? ''
          const isBeat = /^\d$/.test(label)

          return (
            <div
              key={index}
              className={cn(
                'flex flex-col items-center min-w-5 transition-all duration-100 rounded-md px-0.5 py-0.5',
                isActive
                  ? 'scale-125 bg-flame-400/20 shadow-[0_0_8px_rgba(251,146,60,0.3)]'
                  : 'scale-100',
              )}
            >
              <div
                className={cn(
                  'flex flex-col items-center transition-opacity duration-100',
                  isActive ? 'opacity-100' : 'opacity-60',
                )}
              >
                {isDown ? (
                  <div className="flex flex-col items-center">
                    <div className={cn(
                      'w-0.5 h-3 rounded-full',
                      isActive ? 'bg-emerald-300' : 'bg-emerald-400/70',
                    )} />
                    <span className={cn(
                      'text-lg font-bold leading-none -mt-0.5',
                      isActive ? 'text-emerald-300' : 'text-emerald-400',
                    )}>
                      ↓
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <span className={cn(
                      'text-lg font-bold leading-none -mb-0.5',
                      isActive ? 'text-amber-200' : 'text-amber-300',
                    )}>
                      ↑
                    </span>
                    <div className={cn(
                      'w-0.5 h-3 rounded-full',
                      isActive ? 'bg-amber-200' : 'bg-amber-300/70',
                    )} />
                  </div>
                )}
              </div>

              <span className={cn(
                'text-[10px] mt-0.5 leading-none',
                isBeat ? 'text-smoke-400 font-medium' : 'text-smoke-600',
                isActive && 'text-flame-400',
              )}>
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
