import type { CSSProperties } from 'react'
import { ALL_SCENES, type SceneKind } from './tour-worlds'
import './tour.css'

/** Deterministic pseudo-random sequence so particles never jump between renders. */
function seeded(seed: number) {
  let value = seed
  return () => {
    value = (value * 16807) % 2147483647
    return value / 2147483647
  }
}

type Particle = CSSProperties & Record<`--${string}`, string>

function particles(count: number, seed: number, make: (rand: () => number, i: number) => Particle): Particle[] {
  const rand = seeded(seed)
  return Array.from({ length: count }, (_, i) => make(rand, i))
}

const EMBERS = particles(18, 7, (r) => ({
  '--x': `${5 + r() * 90}%`,
  '--s': `${2 + r() * 4}px`,
  '--d': `${6 + r() * 7}s`,
  '--delay': `${-r() * 12}s`,
  '--drift': `${(r() - 0.5) * 18}vw`,
}))

const NOTES = particles(9, 11, (r) => ({
  '--x': `${8 + r() * 84}%`,
  '--s': `${14 + r() * 18}px`,
  '--d': `${10 + r() * 8}s`,
  '--delay': `${-r() * 16}s`,
  '--drift': `${(r() - 0.5) * 20}vw`,
}))

const STARS = particles(40, 23, (r) => ({
  '--x': `${r() * 100}%`,
  '--y': `${r() * 62}%`,
  '--s': `${1 + r() * 2.2}px`,
  '--d': `${1.8 + r() * 3.5}s`,
  '--delay': `${-r() * 5}s`,
}))

const LASERS = particles(8, 5, (r, i) => {
  const fromLeft = i % 2 === 0
  const base = fromLeft ? 18 + r() * 22 : -18 - r() * 22
  return {
    left: fromLeft ? `${4 + r() * 18}%` : `${78 + r() * 18}%`,
    '--from': `${base - 16}deg`,
    '--to': `${base + 16}deg`,
    '--d': `${2.6 + r() * 2.4}s`,
    '--delay': `${-r() * 3}s`,
  }
})

const BEAMS = particles(6, 17, (r, i) => ({
  left: `${6 + i * 17 + r() * 6}%`,
  '--from': `${-22 + r() * 10}deg`,
  '--to': `${12 + r() * 10}deg`,
  '--d': `${5 + r() * 4}s`,
  '--delay': `${-r() * 6}s`,
}))

// Phone lights and lighters held up across the crowd.
const LIGHTERS = particles(64, 29, (r) => ({
  '--x': `${r() * 100}%`,
  '--y': `${4 + r() * 22}%`,
  '--s': `${2 + r() * 3}px`,
  '--d': `${2.4 + r() * 3}s`,
  '--delay': `${-r() * 4}s`,
}))

const RINGS = [0, 0.5, 1, 1.5].map((delay) => ({ '--delay': `${delay}s` }) as Particle)

const WAVES: { fill: string; bottom: string; h: string; d: string }[] = [
  { fill: 'rgba(20, 184, 166, 0.28)', bottom: '10%', h: '26%', d: '19s' },
  { fill: 'rgba(45, 212, 191, 0.32)', bottom: '4%', h: '22%', d: '13s' },
  { fill: 'rgba(8, 60, 66, 0.9)', bottom: '-2%', h: '18%', d: '9s' },
]

function Wave({ fill }: { fill: string }) {
  return (
    <svg viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0 60 C150 20 300 100 450 60 S750 20 900 60 S1050 100 1200 60 L1200 120 L0 120 Z"
        fill={fill}
      />
    </svg>
  )
}

function Scene({ kind }: { kind: SceneKind }) {
  switch (kind) {
    case 'backstage':
      return (
        <>
          <div className="spot spot-left" />
          <div className="spot spot-right" />
        </>
      )
    case 'arena':
      return (
        <>
          {BEAMS.map((style, i) => <span key={i} className="beam" style={style} />)}
          {LIGHTERS.map((style, i) => <span key={i} className="lighter" style={style} />)}
          <div className="crowd crowd-back" />
          <div className="crowd crowd-front" />
        </>
      )
    case 'campfire':
      return <>{EMBERS.map((style, i) => <span key={i} className="ember" style={style} />)}</>
    case 'sunrise':
      return (
        <>
          <div className="sun" />
          {NOTES.map((style, i) => <span key={i} className="note" style={style}>{i % 3 === 0 ? '♫' : '♪'}</span>)}
        </>
      )
    case 'moonlit':
      return (
        <>
          <div className="moon" />
          {STARS.map((style, i) => <span key={i} className="star" style={style} />)}
          <div className="shooting-star" />
        </>
      )
    case 'neon':
      return <>{LASERS.map((style, i) => <span key={i} className={i % 3 === 2 ? 'laser violet' : 'laser'} style={style} />)}</>
    case 'pulse':
      return <>{RINGS.map((style, i) => <span key={i} className="ring" style={style} />)}</>
    case 'sea':
      return (
        <>
          <div className="sea-sun" />
          {WAVES.map((wave) => (
            <div key={wave.d} className="wave" style={{ '--bottom': wave.bottom, '--h': wave.h, '--d': wave.d } as Particle}>
              <Wave fill={wave.fill} />
            </div>
          ))}
        </>
      )
    case 'synth':
      return (
        <>
          <div className="synth-sun" />
          <div className="synth-grid" />
        </>
      )
  }
}

interface TourBackdropProps {
  active: SceneKind
  /** Mount only these scenes (default: all, so moving between stops crossfades). */
  scenes?: readonly SceneKind[]
  /** Hold the lights still — for pages you read from, like the song page. */
  still?: boolean
}

/**
 * The page's scenery. Every world stays mounted and crossfades, so moving
 * between stops feels like the room itself changing; only the active one moves.
 */
export function TourBackdrop({ active, scenes = ALL_SCENES, still = false }: TourBackdropProps) {
  return (
    <div className="tour-backdrop" aria-hidden="true" data-testid="tour-backdrop" data-scene={active} data-still={still || undefined}>
      {scenes.map((kind) => (
        <div key={kind} className={`world-scene scene-${kind}`} data-active={kind === active}>
          <Scene kind={kind} />
        </div>
      ))}
    </div>
  )
}
