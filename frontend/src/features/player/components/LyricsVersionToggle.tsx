import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/cn'
import type { LyricsMode } from '@/stores/player-prefs.store'

interface LyricsVersionToggleProps {
  className?: string
  hasVer1Lyrics: boolean
  hasVer2Lyrics: boolean
  hasVer3Lyrics: boolean
  hasVer4Lyrics?: boolean
  isVer3Generating?: boolean
  selected: LyricsMode
  onSelect: (mode: LyricsMode) => void
}

const OPTIONS: { value: LyricsMode; label: string; shortLabel: string; tooltip: string }[] = [
  { value: 'ver1', label: 'V1 - Fast', shortLabel: 'V1', tooltip: 'V1: Fast lyrics (basic timing, quick to load)' },
  { value: 'ver2', label: 'V2 - Timed', shortLabel: 'V2', tooltip: 'V2: Timed lyrics (word-level highlighting)' },
  { value: 'ver3', label: 'V3 - Best', shortLabel: 'V3', tooltip: 'V3: Corrected lyrics (most accurate, recommended)' },
  { value: 'ver4', label: 'V4 - Alt', shortLabel: 'V4', tooltip: 'V4: Alternative lyrics source' },
  { value: 'none', label: 'Off', shortLabel: 'Off', tooltip: 'Turn off lyrics' },
]

function LyricsIcon({ size = 48, label, className }: { size?: number; label: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('shrink-0', className)}>
      {/* Document */}
      <rect x="4" y="2" width="28" height="36" rx="3" stroke="currentColor" strokeWidth="2.5" fill="none" />
      {/* Text lines */}
      <line x1="10" y1="11" x2="26" y2="11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="10" y1="18" x2="24" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="10" y1="25" x2="20" y2="25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* Version badge */}
      <rect x="24" y="30" width="22" height="16" rx="3" fill="currentColor" />
      <text
        x="35"
        y="41"
        textAnchor="middle"
        fontSize="12"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
        className="fill-charcoal-800"
      >
        {label}
      </text>
    </svg>
  )
}

export function LyricsVersionToggle({
  className,
  hasVer1Lyrics,
  hasVer2Lyrics,
  hasVer3Lyrics,
  hasVer4Lyrics = false,
  isVer3Generating = false,
  selected: lyricsMode,
  onSelect: setLyricsMode,
}: LyricsVersionToggleProps) {

  const available = OPTIONS.filter((opt) => {
    if (opt.value === 'ver1') return hasVer1Lyrics
    if (opt.value === 'ver2') return hasVer2Lyrics
    if (opt.value === 'ver3') return hasVer3Lyrics || isVer3Generating
    if (opt.value === 'ver4') return hasVer4Lyrics
    return true // 'none' is always available
  })

  if (available.length <= 1) return null

  const currentOption = available.find((o) => o.value === lyricsMode) ?? available[0]
  const isCurrentVer3Generating = lyricsMode === 'ver3' && isVer3Generating && !hasVer3Lyrics

  function cycleNext() {
    const currentIdx = available.findIndex((o) => o.value === lyricsMode)
    let nextIdx = (currentIdx + 1) % available.length
    const next = available[nextIdx]
    if (next.value === 'ver3' && isVer3Generating && !hasVer3Lyrics) {
      nextIdx = (nextIdx + 1) % available.length
    }
    setLyricsMode(available[nextIdx].value)
  }

  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center rounded-lg w-16 h-16 relative',
        'bg-charcoal-700 border border-charcoal-600 text-flame-400/70',
        'hover:border-flame-400/30 hover:text-flame-400 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
        className,
      )}
      onClick={cycleNext}
      title={`${currentOption.tooltip}. Click to cycle.`}
      aria-label={`Lyrics mode: ${currentOption.label}`}
      data-testid="lyrics-mode-toggle"
    >
      <LyricsIcon size={48} label={currentOption.shortLabel} />
      {isCurrentVer3Generating && (
        <Loader2 size={12} className="absolute bottom-1 right-1 animate-spin text-flame-400" aria-label="Generating" />
      )}
    </button>
  )
}
