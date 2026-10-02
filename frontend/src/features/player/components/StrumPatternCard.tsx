import { useRef, useEffect, useMemo, useState } from 'react'
import { ExternalLink, Loader2, Play, Square } from 'lucide-react'

import { cn } from '@/lib/cn'
import type { StrumAccents } from '@/types/song'
import type { SectionStrumPattern } from '../lib/strum-pattern'
import { STRUM_SEARCH_MS, beatLabels, guessStepsPerBeat, starterPattern } from '../lib/strum-display'
import { useBoundedLoading } from '../hooks/use-bounded-loading'
import { useStrumPlayback } from '../hooks/use-strum-playback'

interface StrumPatternCardProps {
  sectionPatterns: SectionStrumPattern[]
  bpm: number
  strumNotes?: string | null
  tutorialUrl?: string | null
  tutorialLinks?: { url: string; title: string }[]
  loading?: boolean
  /** The song's meter; picks the starter pattern for songs without a tab pattern. */
  beatsPerBar?: number
  /** Accents measured on the recording; marked on the starter pattern. */
  strumAccents?: StrumAccents | null
  onOpenTutorial?: () => void
}

interface SectionPatternProps {
  section: SectionStrumPattern
  bpm: number
  disabled?: boolean
  onPlayingChange?: (playing: boolean) => void
}

export function StrumPatternCard({ sectionPatterns, bpm, strumNotes, tutorialUrl, tutorialLinks, loading = false, beatsPerBar = 4, strumAccents, onOpenTutorial }: StrumPatternCardProps) {
  const hasTutorials = (tutorialLinks && tutorialLinks.length > 0) || !!tutorialUrl
  const [playingSection, setPlayingSection] = useState<string | null>(null)
  // The pattern lookup can take a while (or never land); don't spin forever.
  const searching = useBoundedLoading(loading && sectionPatterns.length === 0, STRUM_SEARCH_MS)

  const starter = sectionPatterns.length === 0 ? starterPattern(beatsPerBar, strumAccents) : null

  return (
    <>
      <div className="rounded-2xl border border-white/[0.07] bg-stage-950/65 p-3 space-y-3 shadow-[0_12px_30px_rgba(0,0,0,0.35)]" data-testid="strum-pattern-card">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-smoke-100">
            Strumming Pattern
            {sectionPatterns.length > 0 && <span className="ml-1.5 text-[10px] font-normal text-smoke-500">from the song&apos;s tab</span>}
            {starter && !searching && (
              <span className="ml-1.5 rounded-full bg-fire-500/15 px-1.5 py-0.5 text-[10px] font-bold text-fire-300">starter</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {hasTutorials && onOpenTutorial && (
              <button
                type="button"
                onClick={(e: React.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); onOpenTutorial() }}
                className="flex items-center gap-1 text-[11px] text-flame-400 hover:text-flame-300 transition-colors cursor-pointer"
                aria-label="Open tutorial"
                data-testid="strum-tutorial-button"
              >
                <ExternalLink size={11} />
                Learn to play
              </button>
            )}
          </div>
        </div>

        {searching ? (
          <div className="flex items-center gap-2 py-3 justify-center text-smoke-500 text-xs">
            <Loader2 size={14} className="animate-spin" />
            Looking for the strumming pattern…
          </div>
        ) : starter ? (
          <div className="space-y-2" data-testid="strum-starter">
            <p className="text-[11px] leading-relaxed text-smoke-400" data-testid="strum-pattern-none">
              This song&apos;s tab has no strumming yet. This pattern fits most songs in {beatsPerBar === 6 ? '6/8' : `${beatsPerBar}/4`}: try it slowly, then with the band.
            </p>
            <SectionPattern section={starter} bpm={bpm} />
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
          <div className="text-[11px] text-smoke-500 leading-relaxed border-t border-white/10 pt-2">
            {strumNotes}
          </div>
        )}

      </div>

    </>
  )
}

function SectionPattern({ section, bpm, disabled, onPlayingChange }: SectionPatternProps) {
  // This child owns its own playback (useStrumPlayback) and notifies the parent of
  // play/stop transitions via onPlayingChange so the parent can disable other sections'
  // play buttons. Lifting playback into a shared provider would add indirection for a
  // single, local coordination concern, so this pattern is intentional.
  const rawPattern = useMemo(() => section.pattern.map((s) => s.direction), [section.pattern])
  const stepsPerBeat = section.stepsPerBeat ?? guessStepsPerBeat(rawPattern.length)
  // oxlint-disable-next-line react-doctor/no-event-handler
  const { isPlaying, currentBeatIndex, toggle } = useStrumPlayback(rawPattern, bpm, stepsPerBeat, section.accents)
  const labels = beatLabels(rawPattern.length, stepsPerBeat)
  const hasAccents = section.accents?.some(Boolean) ?? false

  // Notify parent when playing state changes
  const prevPlaying = useRef(false)
  useEffect(() => {
    if (prevPlaying.current !== isPlaying) {
      prevPlaying.current = isPlaying
      // oxlint-disable-next-line react-doctor/no-pass-data-to-parent, react-doctor/no-prop-callback-in-effect
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
                ? 'bg-white/[0.04] text-smoke-600 cursor-not-allowed'
                : 'bg-fire-500/15 text-fire-200 hover:bg-fire-500/25',
          )}
          title={isPlaying ? 'Stop' : disabled ? 'Stop current pattern first' : 'Play pattern'}
          aria-label={isPlaying ? 'Stop pattern' : 'Play pattern'}
          data-testid="strum-play-button"
        >
          {isPlaying ? <Square size={10} /> : <Play size={10} className="ml-0.5" />}
        </button>
        <span className="min-w-0 truncate text-xs text-smoke-400" title={section.name} data-testid="strum-section-name">{section.name}</span>
        {section.barShare !== undefined && (
          <span className="shrink-0 text-[10px] text-smoke-600" data-testid="strum-bar-share">
            {Math.round(section.barShare * 100)}% of bars
          </span>
        )}
        <span className="text-[10px] text-smoke-600 ml-auto">{bpm} bpm</span>
      </div>

      {/* Strum arrows with beat labels — wraps on overflow */}
      <div className="flex flex-wrap gap-0.5 items-end">
        {section.pattern.map((step, index) => {
          const isMiss = step.direction === 'miss'
          const isChuck = step.direction === 'chuck'
          const isDown = step.direction === 'down' || isChuck
          const isActive = isPlaying && currentBeatIndex === index
          const isAccent = section.accents?.[index] ?? false
          const label = labels[index] ?? ''
          const isBeat = /^\d+$/.test(label)

          return (
            // Strum steps render in a fixed positional sequence that never reorders,
            // so the positional index is a stable key here.
            // oxlint-disable-next-line react-doctor/no-array-index-key, react-doctor/no-array-index-as-key
            <div key={index}
              className={cn(
                'flex flex-col items-center min-w-5 transition-[transform,background-color,box-shadow] duration-100 rounded-md px-0.5 py-0.5 motion-reduce:transition-none',
                isActive
                  ? 'scale-125 bg-flame-400/20 shadow-[0_0_8px_rgba(251,146,60,0.3)]'
                  : 'scale-100',
              )}
              title={isAccent ? 'Accent: play this stroke harder' : undefined}
              data-testid="strum-step"
              data-direction={step.direction}
              data-accent={isAccent}
            >
              {hasAccents && (
                <span
                  className={cn('text-[10px] font-black leading-none', isAccent ? 'text-flame-300' : 'text-transparent')}
                  aria-hidden="true"
                >
                  &gt;
                </span>
              )}
              <div
                className={cn(
                  'flex flex-col items-center transition-opacity duration-100',
                  isMiss ? 'opacity-25' : isActive || isAccent ? 'opacity-100' : 'opacity-60',
                )}
              >
                {isMiss ? (
                  <div className="flex flex-col items-center h-7.5 justify-center">
                    <span className="text-sm text-smoke-600 leading-none">·</span>
                  </div>
                ) : isDown ? (
                  <div className="flex flex-col items-center">
                    <div className={cn(
                      'w-0.5 h-3 rounded-full',
                      isChuck
                        ? isActive ? 'bg-rose-200' : 'bg-rose-300/70'
                        : isActive ? 'bg-emerald-300' : 'bg-emerald-400/70',
                    )} />
                    <span className={cn(
                      'text-lg font-bold leading-none -mt-0.5',
                      isChuck
                        ? isActive ? 'text-rose-200' : 'text-rose-300'
                        : isActive ? 'text-emerald-300' : 'text-emerald-400',
                    )}>
                      ↓
                    </span>
                    {isChuck && <span className="text-[9px] font-bold leading-none -mt-1 text-rose-300">×</span>}
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

              <span
                className={cn(
                  'text-[10px] mt-0.5 leading-none',
                  isBeat ? 'text-smoke-400 font-medium' : 'text-smoke-600',
                  isActive && 'text-flame-400',
                )}
                data-testid="strum-step-label"
              >
                {label}
              </span>
            </div>
          )
        })}
      </div>
      {hasAccents && (
        <p className="mt-1.5 text-[10px] text-smoke-500">
          <span className="font-black text-flame-300">&gt;</span>{' '}
          {section.accentSource === 'recording'
            ? 'marks the strokes the recording hits hardest: hit those a little harder.'
            : 'marks the snare beats: hit those strokes a little harder.'}
        </p>
      )}
    </div>
  )
}
