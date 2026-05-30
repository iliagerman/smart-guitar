import { useCallback, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ChevronLeft, ChevronRight, Loader2, Play } from 'lucide-react'

import { formatChordName } from '@/lib/chord-colors'
import { loadChordVoicings, type ChordVoicing } from '../lib/chord-voicings'
import { Fretboard } from './Fretboard'

interface ChordVoicingPopoverProps {
  chordName: string
  onPlayFromHere?: () => void
  children: React.ReactNode
}

type LoadState = 'idle' | 'loading' | 'loaded'

/**
 * Wraps a chord label so tapping it during playback opens a popover showing how to play
 * the chord. The curated voicing database is lazily imported on first open, and players
 * can browse alternate voicings with the prev/next controls.
 */
export function ChordVoicingPopover({ chordName, onPlayFromHere, children }: ChordVoicingPopoverProps) {
  const [open, setOpen] = useState(false)
  const [voicings, setVoicings] = useState<ChordVoicing[]>([])
  const [state, setState] = useState<LoadState>('idle')
  const [index, setIndex] = useState(0)

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (!next || state !== 'idle') return
      setState('loading')
      loadChordVoicings(chordName)
        .then((result) => {
          setVoicings(result)
          setIndex(0)
          setState('loaded')
        })
        .catch(() => setState('loaded'))
    },
    [chordName, state],
  )

  const total = voicings.length
  const current = total > 0 ? voicings[Math.min(index, total - 1)] : null

  const goPrev = useCallback(() => setIndex((i) => (i - 1 + total) % total), [total])
  const goNext = useCallback(() => setIndex((i) => (i + 1) % total), [total])

  const handlePlay = useCallback(() => {
    onPlayFromHere?.()
    setOpen(false)
  }, [onPlayFromHere])

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-52 rounded-xl border border-charcoal-700 bg-charcoal-900 p-3 shadow-2xl focus:outline-none"
          data-testid="chord-voicing-popover"
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-sm font-semibold text-smoke-100"
              dir="ltr"
              style={{ unicodeBidi: 'isolate' }}
              data-testid="chord-voicing-name"
            >
              {formatChordName(chordName)}
            </span>
            {total > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={goPrev}
                  className="rounded p-0.5 text-smoke-400 transition-colors hover:text-smoke-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
                  aria-label="Previous voicing"
                  data-testid="chord-voicing-prev"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="font-mono text-xs text-smoke-400" data-testid="chord-voicing-counter">
                  {Math.min(index, total - 1) + 1}/{total}
                </span>
                <button
                  type="button"
                  onClick={goNext}
                  className="rounded p-0.5 text-smoke-400 transition-colors hover:text-smoke-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
                  aria-label="Next voicing"
                  data-testid="chord-voicing-next"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>

          <div className="mt-3 min-h-[120px]">
            {state === 'loading' ? (
              <div className="flex h-[120px] items-center justify-center text-smoke-500">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : current ? (
              <Fretboard voicing={current} />
            ) : (
              <p className="py-8 text-center text-xs text-smoke-500" data-testid="chord-voicing-empty">
                No diagram available
              </p>
            )}
          </div>

          {onPlayFromHere && (
            <button
              type="button"
              onClick={handlePlay}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-flame-400 px-3 py-1.5 text-xs font-semibold text-charcoal-950 transition-colors hover:bg-flame-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
              data-testid="chord-voicing-play"
            >
              <Play size={13} />
              Play from here
            </button>
          )}

          <Popover.Arrow className="fill-charcoal-700" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
