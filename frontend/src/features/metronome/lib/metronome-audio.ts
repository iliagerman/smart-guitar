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

/** Play a short pitched click. Beat one uses a higher, louder accent. */
export function playMetronomeClick(accented: boolean, volume: number): void {
  const context = getAudioContext()
  if (!context || context.state !== 'running' || volume === 0) return

  const now = context.currentTime
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const peak = volume * (accented ? 0.55 : 0.3)

  oscillator.type = 'square'
  oscillator.frequency.value = accented ? 1500 : 850
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.003)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (accented ? 0.09 : 0.06))

  oscillator.connect(gain).connect(context.destination)
  oscillator.start(now)
  oscillator.stop(now + (accented ? 0.1 : 0.07))
}
