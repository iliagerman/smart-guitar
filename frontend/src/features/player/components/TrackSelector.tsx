import * as Popover from '@radix-ui/react-popover'
import { useMemo, useState } from 'react'

import { cn } from '@/lib/cn'
import { type StemType } from '@/types/song'
import { MixerIcon, StemIcon } from './StemIcons'

interface TrackSelection {
  isFullSong: boolean
  stems: string[]
}

interface TrackSelectorProps {
  activeStems: string[]
  isFullSong: boolean
  onApplySelection: (selection: TrackSelection) => void
  availableStems: Record<string, string | null>
  stemTypes: StemType[]
  isDisabled?: boolean
}

function sortStems(stems: string[]): string[] {
  return [...stems].sort()
}

function sameStemSelection(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return sortStems(left).every((stem, index) => stem === sortStems(right)[index])
}

/**
 * Stem mixer dropdown — lets users draft a stem selection locally and apply it once.
 * This avoids firing a backend mix request on every individual toggle.
 */
export function TrackSelector({
  activeStems,
  isFullSong,
  onApplySelection,
  availableStems,
  stemTypes,
  isDisabled = false,
}: TrackSelectorProps) {
  const [open, setOpen] = useState(false)
  const [draftIsFullSong, setDraftIsFullSong] = useState(isFullSong)
  const [draftStems, setDraftStems] = useState(activeStems)

  const hasChanges = useMemo(() => {
    if (draftIsFullSong !== isFullSong) return true
    return !sameStemSelection(draftStems, activeStems)
  }, [draftIsFullSong, isFullSong, draftStems, activeStems])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftIsFullSong(isFullSong)
      setDraftStems(activeStems)
    }
    setOpen(nextOpen)
  }

  const handleSelectFullSong = () => {
    setDraftIsFullSong(true)
    setDraftStems([])
  }

  const handleToggleDraftStem = (stem: string) => {
    if (draftStems.includes(stem)) {
      const next = draftStems.filter((item) => item !== stem)
      setDraftStems(next)
      setDraftIsFullSong(next.length === 0)
      return
    }

    setDraftIsFullSong(false)
    setDraftStems([...draftStems, stem])
  }

  const handleCancel = () => {
    setDraftIsFullSong(isFullSong)
    setDraftStems(activeStems)
    setOpen(false)
  }

  const handleApply = () => {
    const normalizedStems = sortStems(draftStems)
    if (draftIsFullSong || normalizedStems.length === 0) {
      onApplySelection({ isFullSong: true, stems: [] })
    } else {
      onApplySelection({ isFullSong: false, stems: normalizedStems })
    }
    setOpen(false)
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-16 w-16 items-center justify-center rounded-lg border bg-charcoal-700 text-flame-400/70 transition-colors',
            isDisabled
              ? 'cursor-not-allowed border-charcoal-700 opacity-50'
              : 'border-charcoal-600 hover:border-flame-400/30 hover:text-flame-400',
            'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
          )}
          title="Stem mixer"
          aria-label="Open stem mixer"
          data-testid="track-selector"
          disabled={isDisabled}
        >
          <MixerIcon size={48} />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={8}
          align="center"
          className={cn(
            'z-50 w-56 rounded-xl border border-charcoal-600 bg-charcoal-800 shadow-xl',
            'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          )}
        >
          <div className="p-2">
            <button
              type="button"
              onClick={handleSelectFullSong}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                draftIsFullSong
                  ? 'bg-flame-400/15 text-flame-400'
                  : 'text-smoke-200 hover:bg-charcoal-700 hover:text-smoke-100',
              )}
              data-testid="track-selector-full-song"
            >
              <StemIcon stem="full_mix" size={24} />
              <span className="font-medium">Full Song</span>
              {draftIsFullSong && (
                <span className="ml-auto text-flame-400" aria-hidden="true">&#10003;</span>
              )}
            </button>

            <div className="mx-3 my-1 h-px bg-charcoal-600" />

            {stemTypes.map(({ name, label }) => {
              const available = !!availableStems[name]
              const active = !draftIsFullSong && draftStems.includes(name)

              return (
                <button
                  key={name}
                  type="button"
                  disabled={!available}
                  onClick={() => handleToggleDraftStem(name)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                    !available && 'cursor-not-allowed opacity-40',
                    available && active && 'bg-flame-400/15 text-flame-400',
                    available && !active && 'text-smoke-200 hover:bg-charcoal-700 hover:text-smoke-100',
                  )}
                  data-testid={`track-selector-stem-${name}`}
                >
                  <StemIcon stem={name} size={24} />
                  <span className="font-medium">{label}</span>
                  <span
                    className={cn(
                      'relative ml-auto inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors',
                      active ? 'bg-flame-500' : 'bg-charcoal-600',
                      !available && 'opacity-50',
                    )}
                    aria-hidden="true"
                  >
                    <span
                      className={cn(
                        'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                        active ? 'translate-x-4' : 'translate-x-0',
                      )}
                    />
                  </span>
                </button>
              )
            })}

            <div className="mt-3 flex items-center justify-end gap-2 border-t border-charcoal-700 pt-3">
              <button
                type="button"
                onClick={handleCancel}
                className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm text-smoke-300 transition-colors hover:bg-charcoal-700 hover:text-smoke-100"
                data-testid="track-selector-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={!hasChanges || isDisabled}
                className={cn(
                  'inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors',
                  !hasChanges || isDisabled
                    ? 'cursor-not-allowed bg-flame-400/50 text-charcoal-950/70 opacity-50'
                    : 'bg-flame-400 text-charcoal-950 hover:bg-flame-500',
                )}
                data-testid="track-selector-apply"
              >
                Apply
              </button>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
