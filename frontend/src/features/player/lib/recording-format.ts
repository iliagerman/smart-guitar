/**
 * Microphone capture constraints, chosen by whether the backing track is mixed
 * in digitally (headphones) or played out the speaker (mic-only).
 *
 * In speaker mode the backing track leaks into the mic and drowns the guitar.
 * Echo cancellation subtracts the speaker output and auto gain lifts the quiet
 * acoustic guitar, so the recording captures the player rather than the backing
 * track. In digital-mix mode there is no leak, so everything stays raw for the
 * cleanest tone.
 */
export function getRecordingAudioConstraints(isDigitalMix: boolean): MediaTrackConstraints {
  return {
    echoCancellation: !isDigitalMix,
    noiseSuppression: false,
    autoGainControl: !isDigitalMix,
  }
}

/** File extension for a MediaRecorder mime type. Defaults to webm. */
export function fileExtensionForMimeType(mimeType: string): string {
  if (mimeType.startsWith('video/mp4')) return 'mp4'
  return 'webm'
}
