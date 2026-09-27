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

/** Play a short pitched click: highest for beat one, then accents, then plain beats. */
export function playMetronomeClick(emphasis: BeatEmphasis, volume: number): void {
  const context = getAudioContext()
  if (!context || context.state !== 'running' || volume === 0) return

  const sound = CLICK_SOUND[emphasis]
  const now = context.currentTime
  const oscillator = context.createOscillator()
  const gain = context.createGain()

  oscillator.type = 'square'
  oscillator.frequency.value = sound.frequency
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(volume * sound.peak, now + 0.003)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + sound.seconds)

  oscillator.connect(gain).connect(context.destination)
  oscillator.start(now)
  oscillator.stop(now + sound.seconds + 0.01)
}
