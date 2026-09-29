import * as Popover from '@radix-ui/react-popover'
import { SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { cn } from '@/lib/cn'
import { findBestCapoFrets } from '@/lib/chord-simplifier'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { ChordOption, ChordEntry } from '@/types/song'

import { dockPillClass, dockPopoverClass } from '../lib/dock-button'
import { getSheetVersionDescription, getSheetVersionLabel } from '../lib/sheet-versions'

interface SheetSelectorProps {
  versions: ChordOption[]
  selectedVersionIndex: number
  activeChords: ChordEntry[]
  hasTabs?: boolean
  hasBars?: boolean
  currentUserEmail?: string
  upgrading?: boolean
  onSelectVersionIndex: (index: number) => void
  onDeleteCurrentVersion?: () => void
}

interface SheetViewOption {
  key: string
  label: string
  apply: () => void
}

/**
 * The sheet's settings: how the chords are shown (Chords/Easy/Capo/Bars/Tabs),
 * a custom capo, and the chord source (also on the sheet's source tabs).
 */
export function SheetSelector({
  versions,
  selectedVersionIndex,
  activeChords,
  hasTabs = false,
  hasBars = false,
  currentUserEmail,
  upgrading = false,
  onSelectVersionIndex,
  onDeleteCurrentVersion,
}: SheetSelectorProps) {
  const [open, setOpen] = useState(false)
  const chordDisplayMode = usePlaybackStore((s) => s.chordDisplayMode)
  const chordCapoFret = usePlaybackStore((s) => s.chordCapoFret)
  const sheetMode = usePlaybackStore((s) => s.sheetMode)
  const setSheetMode = usePlaybackStore((s) => s.setSheetMode)
  const setChordDisplayMode = usePlaybackStore((s) => s.setChordDisplayMode)
  const currentSongId = usePlaybackStore((s) => s.currentSongId)
  const setSongOverride = usePlayerPrefsStore((s) => s.setSongOverride)

  const bestCapoFrets = useMemo(
    () => (activeChords.length > 0 ? findBestCapoFrets(activeChords) : []),
    [activeChords],
  )

  const clampedIndex = Math.min(selectedVersionIndex, Math.max(versions.length - 1, 0))
  const currentVersion = versions[clampedIndex] ?? versions[0]

  const viewOptions = useMemo(() => {
    return buildViewOptions({
      hasTabs,
      hasBars,
      currentSongId,
      setSongOverride,
      setSheetMode,
      setChordDisplayMode,
      close: () => setOpen(false),
    })
  }, [currentSongId, hasTabs, hasBars, setChordDisplayMode, setSheetMode, setSongOverride])

  const currentViewKey =
    sheetMode === 'tabs'
      ? 'tabs'
      : sheetMode === 'bars'
        ? 'bars'
        : chordDisplayMode === 'capo'
          ? `capo-${chordCapoFret}`
          : chordDisplayMode
  const currentView = viewOptions.find((option) => option.key === currentViewKey) ?? viewOptions[0]
  const currentSourceLabel = getSheetVersionLabel(currentVersion, clampedIndex)
  const currentLabel = `${currentSourceLabel} · ${currentView.label}`
  const currentIsOwned =
    !!currentUserEmail && !!currentVersion?.created_by && currentVersion.created_by === currentUserEmail

  if (versions.length < 2 && viewOptions.length < 2 && !upgrading) {
    return null
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={dockPillClass(open, 'h-9 px-3 text-xs max-sm:px-2.5')}
          title={`Sheet: ${currentLabel}`}
          aria-label={`Sheet settings: ${currentLabel}`}
          data-tour="version-toggle"
          data-testid="sheet-selector-trigger"
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          <span className="truncate max-sm:hidden">{currentView.label}</span>
          {upgrading && (
            <Sparkles size={14} className="animate-pulse max-sm:hidden" aria-label="Updating AI chords" />
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          sideOffset={8}
          align="end"
          collisionPadding={12}
          className={cn(
            'w-72 max-h-[70dvh] overflow-y-auto overscroll-contain touch-pan-y',
            dockPopoverClass,
            'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          )}
        >
          <div className="p-2" data-testid="sheet-selector-popover">
            <SectionTitle title="Chord source" />
            <div className="space-y-1">
              {versions.map((version, index) => {
                const label = getSheetVersionLabel(version, index)
                const isSelected = index === clampedIndex
                return (
                  <button
                    key={version.version_key ?? `${label}-${index}`}
                    type="button"
                    onClick={() => {
                      onSelectVersionIndex(index)
                      setOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                      isSelected
                        ? 'bg-fire-500/15 text-fire-200'
                        : 'text-smoke-200 hover:bg-white/[0.06] hover:text-smoke-50',
                    )}
                    data-testid={`sheet-selector-source-${index}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{label}</div>
                      <div className={cn('text-xs', isSelected ? 'text-fire-200/80' : 'text-smoke-500')}>
                        {getSheetVersionDescription(version)}
                      </div>
                    </div>
                    {isSelected && <span className="ml-auto pt-0.5" aria-hidden="true">&#10003;</span>}
                  </button>
                )
              })}
            </div>

            <div className="mx-3 my-2 h-px bg-white/10" />

            <SectionTitle title="Display" />
            <div className="space-y-1">
              {viewOptions.filter((option) =>
                !option.key.startsWith('capo-') ||
                bestCapoFrets.some(({ fret }) => option.key === `capo-${fret}`),
              ).map((option) => {
                const isSelected = option.key === currentViewKey
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={option.apply}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                      isSelected
                        ? 'bg-fire-500/15 text-fire-200'
                        : 'text-smoke-200 hover:bg-white/[0.06] hover:text-smoke-50',
                    )}
                    data-testid={`sheet-selector-view-${option.key}`}
                  >
                    <span className="font-medium">{option.label}</span>
                    {isSelected && <span className="ml-auto" aria-hidden="true">&#10003;</span>}
                  </button>
                )
              })}
            </div>

            <label className="mx-3 mt-3 flex flex-col gap-1.5 text-sm text-smoke-200">
              <span className="font-medium">Custom capo</span>
              <select
                aria-label="Custom capo fret"
                data-testid="custom-capo-fret"
                value={chordDisplayMode === 'capo' ? `capo-${chordCapoFret}` : ''}
                onChange={(event) => viewOptions.find((option) => option.key === event.target.value)?.apply()}
                className="min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 text-smoke-100 focus:outline-none focus:ring-2 focus:ring-flame-400/50"
              >
                <option value="" disabled>Select fret</option>
                {viewOptions.filter((option) => option.key.startsWith('capo-')).map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.key === 'capo-0' ? 'No capo (0)' : option.label}
                    {bestCapoFrets.some(({ fret }) => option.key === `capo-${fret}`) ? ' (suggested)' : ''}
                  </option>
                ))}
              </select>
              <span className="text-xs text-smoke-500">Chord shapes adjust to your fret. Audio pitch stays unchanged.</span>
            </label>

            {currentIsOwned && onDeleteCurrentVersion && (
              <>
                <div className="mx-3 my-2 h-px bg-white/10" />
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onDeleteCurrentVersion()
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm transition-colors',
                    'text-red-300 hover:bg-red-500/10 hover:text-red-200',
                  )}
                  aria-label="Delete your custom sheet"
                  data-testid="sheet-selector-delete-button"
                >
                  <Trash2 size={16} aria-hidden="true" />
                  <span className="font-medium">Delete custom sheet</span>
                </button>
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

interface BuildViewOptionsParams {
  hasTabs: boolean
  hasBars: boolean
  currentSongId: string | null
  setSongOverride: ReturnType<typeof usePlayerPrefsStore.getState>['setSongOverride']
  setSheetMode: ReturnType<typeof usePlaybackStore.getState>['setSheetMode']
  setChordDisplayMode: ReturnType<typeof usePlaybackStore.getState>['setChordDisplayMode']
  close: () => void
}

function buildViewOptions({
  hasTabs,
  hasBars,
  currentSongId,
  setSongOverride,
  setSheetMode,
  setChordDisplayMode,
  close,
}: BuildViewOptionsParams): SheetViewOption[] {
  const persist = (
    mode: 'standard' | 'beginner' | 'capo',
    fret: number,
    sheet: 'chords' | 'tabs' | 'bars',
  ) => {
    if (!currentSongId) {
      return
    }
    setSongOverride(currentSongId, 'chordDisplayMode', mode)
    setSongOverride(currentSongId, 'chordCapoFret', fret)
    setSongOverride(currentSongId, 'sheetMode', sheet)
  }

  const applyView = (
    mode: 'standard' | 'beginner' | 'capo',
    fret: number,
    sheet: 'chords' | 'tabs' | 'bars',
  ) => {
    setSheetMode(sheet)
    setChordDisplayMode(mode, fret)
    persist(mode, fret, sheet)
    close()
  }

  const options: SheetViewOption[] = [
    { key: 'standard', label: 'Chords', apply: () => applyView('standard', 0, 'chords') },
    { key: 'beginner', label: 'Easy', apply: () => applyView('beginner', 0, 'chords') },
  ]

  for (let fret = 0; fret <= 12; fret++) {
    options.push({
      key: `capo-${fret}`,
      label: `Capo ${fret}`,
      apply: () => applyView('capo', fret, 'chords'),
    })
  }

  if (hasBars) {
    options.push({ key: 'bars', label: 'Bars', apply: () => applyView('standard', 0, 'bars') })
  }

  if (hasTabs) {
    options.push({ key: 'tabs', label: 'Tabs', apply: () => applyView('standard', 0, 'tabs') })
  }

  return options
}

interface SectionTitleProps {
  title: string
}

function SectionTitle({ title }: SectionTitleProps) {
  return <div className="px-3 pb-1 text-[11px] uppercase tracking-[0.14em] text-smoke-500">{title}</div>
}
