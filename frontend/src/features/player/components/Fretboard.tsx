import { useMemo } from 'react'

import { cn } from '@/lib/cn'
import type { ChordVoicing } from '../lib/chord-shapes'

const STRINGS = ['E', 'A', 'D', 'G', 'B', 'e'] as const
const STRING_COUNT = STRINGS.length
const MIN_ROWS = 5
const ROW_HEIGHT_PX = 18

interface DotMarker {
  stringIdx: number
  row: number
  finger: number
}

interface BarreMarker {
  row: number
  minIdx: number
  maxIdx: number
  finger: number
}

interface FretboardLayout {
  rows: number
  showNut: boolean
  dots: DotMarker[]
  barreMarkers: BarreMarker[]
}

/** Pre-compute dot/barre positions from a normalized (absolute-fret) voicing. */
function computeLayout({ frets, fingers, baseFret, barres }: ChordVoicing): FretboardLayout {
  const barreFrets = new Set(barres)
  const fretted = frets.filter((f) => f > 0)
  const maxRow = fretted.length ? Math.max(...fretted.map((f) => f - baseFret + 1)) : 1
  const rows = Math.max(MIN_ROWS, maxRow)

  const dots: DotMarker[] = []
  for (let stringIdx = 0; stringIdx < frets.length; stringIdx++) {
    const fret = frets[stringIdx]
    if (fret <= 0 || barreFrets.has(fret)) continue
    const row = fret - baseFret + 1
    if (row < 1 || row > rows) continue
    dots.push({ stringIdx, row, finger: fingers[stringIdx] ?? 0 })
  }

  const barreMarkers: BarreMarker[] = []
  for (const barreFret of barreFrets) {
    const covered = frets
      .map((f, i) => (f === barreFret ? i : -1))
      .filter((i) => i >= 0)
    if (covered.length === 0) continue
    const minIdx = Math.min(...covered)
    const maxIdx = Math.max(...covered)
    barreMarkers.push({
      row: barreFret - baseFret + 1,
      minIdx,
      maxIdx,
      finger: fingers[minIdx] ?? 0,
    })
  }

  return { rows, showNut: baseFret === 1, dots, barreMarkers }
}

const columnCenterPct = (stringIdx: number): number => ((stringIdx + 0.5) / STRING_COUNT) * 100

interface FretboardProps {
  voicing: ChordVoicing
  className?: string
}

/**
 * Renders a single guitar chord voicing as a fingering diagram: open/muted markers,
 * the fret grid, finger dots (with finger numbers), and any barres. Absolute fret
 * numbers in the voicing are mapped onto a window starting at `voicing.baseFret`.
 */
export function Fretboard({ voicing, className }: FretboardProps) {
  const { rows, showNut, dots, barreMarkers } = useMemo(() => computeLayout(voicing), [voicing])
  const boardHeight = rows * ROW_HEIGHT_PX
  const rowTopPct = (row: number): number => ((row - 0.5) / rows) * 100

  return (
    <div className={cn('relative select-none pl-5', className)}>
      {voicing.baseFret > 1 && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[10px] font-mono text-smoke-500">
          {voicing.baseFret}fr
        </span>
      )}

      {/* Open (o) / muted (x) markers above the nut */}
      <div className="grid grid-cols-6 gap-1 text-[10px] font-mono text-smoke-500">
        {voicing.frets.map((f, i) => (
          // String columns render in fixed low-E -> high-e order and never reorder.
          // oxlint-disable-next-line react-doctor/no-array-index-key
          <div key={i} className="text-center">
            {f === -1 ? 'x' : f === 0 ? 'o' : ''}
          </div>
        ))}
      </div>

      <div className="relative mt-1">
        {/* String lines + fret lines */}
        <div className="grid grid-cols-6 gap-1">
          {STRINGS.map((stringNote) => (
            <div key={stringNote} className="relative">
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-charcoal-600" />
              <div className="flex flex-col justify-between" style={{ height: `${boardHeight}px` }}>
                {Array.from({ length: rows + 1 }).map((_, rowIdx) => (
                  <div
                    // Fret lines render top-to-bottom in fixed order.
                    // oxlint-disable-next-line react-doctor/no-array-index-key
                    key={rowIdx}
                    className={cn('h-px w-full', rowIdx === 0 && showNut ? 'bg-smoke-500/60' : 'bg-charcoal-600')}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Barres */}
        {barreMarkers.map((barre) => {
          const left = columnCenterPct(barre.minIdx)
          const right = columnCenterPct(barre.maxIdx)
          return (
            <div
              key={`barre-${barre.row}`}
              className="absolute flex items-center justify-center rounded-full bg-flame-400 text-[9px] font-bold text-charcoal-950 shadow-[0_0_10px_rgba(250,204,21,0.25)]"
              style={{
                left: `${left}%`,
                width: `${right - left}%`,
                top: `${rowTopPct(barre.row)}%`,
                height: `${ROW_HEIGHT_PX * 0.66}px`,
                transform: 'translateY(-50%)',
              }}
            >
              {barre.finger > 0 ? barre.finger : ''}
            </div>
          )
        })}

        {/* Finger dots */}
        {dots.map((dot) => (
          <div
            key={`dot-${dot.stringIdx}`}
            className="absolute flex items-center justify-center rounded-full bg-flame-400 text-[9px] font-bold text-charcoal-950 shadow-[0_0_10px_rgba(250,204,21,0.25)]"
            style={{
              left: `${columnCenterPct(dot.stringIdx)}%`,
              top: `${rowTopPct(dot.row)}%`,
              width: `${ROW_HEIGHT_PX * 0.78}px`,
              height: `${ROW_HEIGHT_PX * 0.78}px`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            {dot.finger > 0 ? dot.finger : ''}
          </div>
        ))}
      </div>

      {/* String letters */}
      <div className="mt-1 grid grid-cols-6 gap-1 text-[10px] font-mono text-smoke-500">
        {STRINGS.map((s) => (
          <div key={s} className="text-center">
            {s}
          </div>
        ))}
      </div>
    </div>
  )
}
