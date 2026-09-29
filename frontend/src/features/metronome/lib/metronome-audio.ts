import type { BeatEmphasis } from './beat-emphasis'

type AudioContextConstructor = typeof AudioContext

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext

  const AudioContextClass = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
  if (!AudioContextClass) return null

  audioContext = new AudioContextClass()
  return audioContext
}

/** Unlock Web Audio from a user gesture before timer-driven clicks begin. */
export function resumeMetronomeAudio(): void {
  const context = getAudioContext()
  if (context?.state === 'suspended') void context.resume()
}

const CLICK_SOUND: Record<BeatEmphasis, { frequency: number; peak: number; seconds: number }> = {
  downbeat: { frequency: 1500, peak: 0.55, seconds: 0.09 },
  accent: { frequency: 1150, peak: 0.45, seconds: 0.08 },
  normal: { frequency: 850, peak: 0.3, seconds: 0.06 },
}

/**
 * Play a short pitched click `delaySeconds` from now: highest for beat one, then
 * accents, then plain beats. Returns a function that silences it if it hasn't
 * sounded yet, or null when nothing was scheduled.
 */
export function playMetronomeClick(emphasis: BeatEmphasis, volume: number, delaySeconds = 0): (() => void) | null {
  const context = getAudioContext()
  if (!context || context.state !== 'running' || volume === 0) return null

  const sound = CLICK_SOUND[emphasis]
  const start = context.currentTime + Math.max(0, delaySeconds)
  const oscillator = context.createOscillator()
  const gain = context.createGain()

  oscillator.type = 'square'
  oscillator.frequency.value = sound.frequency
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume * sound.peak, start + 0.003)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + sound.seconds)

  oscillator.connect(gain).connect(context.destination)
  oscillator.start(start)
  oscillator.stop(start + sound.seconds + 0.01)
  return () => {
    if (context.currentTime < start) gain.disconnect()
  }
}
