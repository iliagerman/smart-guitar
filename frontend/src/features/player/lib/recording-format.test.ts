import { describe, it, expect } from 'vitest'
import { getRecordingAudioConstraints, fileExtensionForMimeType } from './recording-format'

describe('getRecordingAudioConstraints', () => {
  it('captures raw, unprocessed audio in digital-mix (headphones) mode', () => {
    // With headphones there is no speaker leak to cancel and no quiet-guitar
    // problem to compensate for, so all browser processing stays off for the
    // cleanest guitar tone.
    expect(getRecordingAudioConstraints(true)).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    })
  })

  it('enables echo cancellation and auto gain in speaker (mic-only) mode', () => {
    // Without headphones the backing track plays out the speaker and leaks into
    // the mic. Echo cancellation subtracts that leak; auto gain lifts the quiet
    // acoustic guitar. Noise suppression stays off — it mangles sustained notes.
    expect(getRecordingAudioConstraints(false)).toEqual({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
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
