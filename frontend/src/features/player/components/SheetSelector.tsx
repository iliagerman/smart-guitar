import * as Popover from '@radix-ui/react-popover'
import { Music2, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { cn } from '@/lib/cn'
import { findBestCapoFrets } from '@/lib/chord-simplifier'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { ChordOption, ChordEntry } from '@/types/song'

import { getSheetVersionDescription, getSheetVersionLabel } from '../lib/sheet-versions'

interface SheetSelectorProps {
  versions: ChordOption[]
  selectedVersionIndex: number
  activeChords: ChordEntry[]
  hasTabs?: boolean
  hasStaticChords?: boolean
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
 * Unified sheet control for source selection (Auto/AI/Custom) and display mode
 * (Chords/Easy/Capo/Tabs). This replaces the separate V1/V2 toggle and view pill.
 */
export function SheetSelector({
  versions,
  selectedVersionIndex,
  activeChords,
  hasTabs = false,
  hasStaticChords = false,
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
      bestCapoFrets,
      hasTabs,
      hasStaticChords,
      currentSongId,
      setSongOverride,
      setSheetMode,
      setChordDisplayMode,
      close: () => setOpen(false),
    })
  }, [bestCapoFrets, currentSongId, hasTabs, hasStaticChords, setChordDisplayMode, setSheetMode, setSongOverride])

  const currentViewKey =
    sheetMode === 'static'
      ? 'static'
      : sheetMode === 'tabs'
        ? 'tabs'
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
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium',
            'bg-charcoal-700 border border-charcoal-600 text-smoke-100',
            'hover:border-flame-400/30 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
          )}
          title={`Sheet: ${currentLabel}`}
          aria-label={`Sheet selector: ${currentLabel}`}
          data-tour="version-toggle"
          data-testid="sheet-selector-trigger"
        >
          <Music2 size={16} className="text-smoke-300" aria-hidden="true" />
          <span className="truncate">{currentLabel}</span>
          {upgrading && (
            <Sparkles size={14} className="text-flame-400 animate-pulse" aria-label="Updating AI chords" />
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={8}
          align="start"
          className={cn(
            'w-72 rounded-xl border border-charcoal-600 bg-charcoal-800 shadow-xl z-50',
            'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          )}
        >
          <div className="p-2" data-testid="sheet-selector-popover">
            <SectionTitle title="Sheet source" />
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
                      'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                      isSelected
                        ? 'bg-flame-400/15 text-flame-400'
                        : 'text-smoke-200 hover:bg-charcoal-700 hover:text-smoke-100',
                    )}
                    data-testid={`sheet-selector-source-${index}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{label}</div>
                      <div className={cn('text-xs', isSelected ? 'text-flame-200/85' : 'text-smoke-500')}>
                        {getSheetVersionDescription(version)}
                      </div>
                    </div>
                    {isSelected && <span className="ml-auto pt-0.5" aria-hidden="true">&#10003;</span>}
                  </button>
                )
              })}
            </div>

            <div className="mx-3 my-2 h-px bg-charcoal-600" />

            <SectionTitle title="Display" />
            <div className="space-y-1">
              {viewOptions.map((option) => {
                const isSelected = option.key === currentViewKey
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={option.apply}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                      isSelected
                        ? 'bg-flame-400/15 text-flame-400'
                        : 'text-smoke-200 hover:bg-charcoal-700 hover:text-smoke-100',
                    )}
                    data-testid={`sheet-selector-view-${option.key}`}
                  >
                    <span className="font-medium">{option.label}</span>
                    {isSelected && <span className="ml-auto" aria-hidden="true">&#10003;</span>}
                  </button>
                )
              })}
            </div>

            {currentIsOwned && onDeleteCurrentVersion && (
              <>
                <div className="mx-3 my-2 h-px bg-charcoal-600" />
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onDeleteCurrentVersion()
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors',
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
  bestCapoFrets: Array<{ fret: number }>
  hasTabs: boolean
  hasStaticChords: boolean
  currentSongId: string | null
  setSongOverride: ReturnType<typeof usePlayerPrefsStore.getState>['setSongOverride']
  setSheetMode: ReturnType<typeof usePlaybackStore.getState>['setSheetMode']
  setChordDisplayMode: ReturnType<typeof usePlaybackStore.getState>['setChordDisplayMode']
  close: () => void
}

function buildViewOptions({
  bestCapoFrets,
  hasTabs,
  hasStaticChords,
  currentSongId,
  setSongOverride,
  setSheetMode,
  setChordDisplayMode,
  close,
}: BuildViewOptionsParams): SheetViewOption[] {
  const persist = (
    mode: 'standard' | 'beginner' | 'capo',
    fret: number,
    sheet: 'chords' | 'tabs' | 'static',
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
    sheet: 'chords' | 'tabs' | 'static',
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

  for (const { fret } of bestCapoFrets) {
    options.push({
      key: `capo-${fret}`,
      label: `Capo ${fret}`,
      apply: () => applyView('capo', fret, 'chords'),
    })
  }

  if (hasTabs) {
    options.push({ key: 'tabs', label: 'Tabs', apply: () => applyView('standard', 0, 'tabs') })
  }

  if (hasStaticChords) {
    options.push({ key: 'static', label: 'Chord Sheet', apply: () => applyView('standard', 0, 'static') })
  }

  return options
}

interface SectionTitleProps {
  title: string
}

function SectionTitle({ title }: SectionTitleProps) {
  return <div className="px-3 pb-1 text-[11px] uppercase tracking-[0.14em] text-smoke-500">{title}</div>
}
