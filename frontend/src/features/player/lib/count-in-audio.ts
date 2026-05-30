/**
 * Tiny Web Audio click generator for the playback count-in.
 *
 * Uses its own lightweight AudioContext (separate from the stem mixer) so a short
 * metronome-style tick can sound on each beat of the 3-2-1 count. The context must
 * be resumed inside a user gesture before the ticks are scheduled, otherwise mobile
 * browsers leave it suspended — call {@link resumeTickContext} from the play handler.
 */

type AudioContextCtor = typeof AudioContext

let context: AudioContext | null = null

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ?? null
}

function getContext(): AudioContext | null {
  if (context) return context
  const Ctor = getAudioContextCtor()
  if (!Ctor) return null
  context = new Ctor()
  return context
}

/** Resume the tick context inside a user gesture so later ticks are audible. */
export async function resumeTickContext(): Promise<void> {
  const ctx = getContext()
  if (!ctx || ctx.state === 'running') return
  try {
    await ctx.resume()
  } catch {
    // Best effort — if the browser blocks it, the count-in is silent but still visual.
  }
}

interface TickOptions {
  /** Accent the downbeat (higher pitch, slightly louder) when playback begins. */
  accent?: boolean
}

/** Play one short click. Safe to call repeatedly; no-op when Web Audio is unavailable. */
export function playTick({ accent = false }: TickOptions = {}): void {
  const ctx = getContext()
  if (!ctx || ctx.state !== 'running') return

  const now = ctx.currentTime
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()

  oscillator.type = 'square'
  oscillator.frequency.value = accent ? 1320 : 880

  const peak = accent ? 0.32 : 0.22
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11)

  oscillator.connect(gain).connect(ctx.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.12)
}
