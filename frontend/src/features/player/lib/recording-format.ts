/**
 * Microphone capture constraints for recording — always raw, all browser
 * processing off.
 *
 * Echo cancellation and auto gain force mobile mics (iOS Safari especially)
 * into voice-call mode: thin mono downsampling, and they actively cancel the
 * backing track out of the mic. In speaker/mic-only and video modes the mic is
 * the only path the backing track reaches the recording, so cancelling it
 * erased the backing entirely. Raw capture is the working behavior for every
 * mode — the mic hears the full performance, and headphone/digital-mix mode
 * gets a clean guitar tone with no speaker leak to begin with.
 */
export function getRecordingAudioConstraints(): MediaTrackConstraints {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  }
}

/** File extension for a MediaRecorder mime type. Defaults to webm. */
export function fileExtensionForMimeType(mimeType: string): string {
  if (mimeType.startsWith('video/mp4')) return 'mp4'
  return 'webm'
}
