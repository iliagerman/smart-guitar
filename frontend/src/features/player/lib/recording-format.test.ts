import { describe, it, expect } from 'vitest'
import { getRecordingAudioConstraints, fileExtensionForMimeType } from './recording-format'

describe('getRecordingAudioConstraints', () => {
  it('captures raw, unprocessed mic audio for every recording mode', () => {
    // Echo cancellation / auto gain force mobile mics into voice-call mode:
    // thin mono downsampling, and — critically — they cancel the backing track
    // out of the mic. In speaker/mic-only and video modes the mic is the ONLY
    // path the backing track reaches the recording, so cancelling it erased the
    // backing entirely and the result sounded thin and guitar-only. Raw capture
    // is the working behavior for all modes; the mic hears the full performance.
    expect(getRecordingAudioConstraints()).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    })
  })
})

describe('fileExtensionForMimeType', () => {
  it('maps mp4 container mime types to mp4', () => {
    expect(fileExtensionForMimeType('video/mp4')).toBe('mp4')
    expect(fileExtensionForMimeType('video/mp4;codecs=avc1,mp4a.40.2')).toBe('mp4')
  })

  it('maps webm container mime types to webm', () => {
    expect(fileExtensionForMimeType('video/webm')).toBe('webm')
    expect(fileExtensionForMimeType('video/webm;codecs=vp9,opus')).toBe('webm')
  })

  it('falls back to webm for unknown or empty mime types', () => {
    expect(fileExtensionForMimeType('')).toBe('webm')
    expect(fileExtensionForMimeType('application/octet-stream')).toBe('webm')
  })
})
