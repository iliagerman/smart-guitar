export type ShareStatus = 'shared' | 'cancelled' | 'unsupported'

/**
 * Attempt to share a recorded blob via the native Web Share API.
 *
 * Returns the outcome: 'shared', 'cancelled', or 'unsupported'.
 */
export async function shareRecording(
  blob: Blob,
  filename: string,
): Promise<ShareStatus> {
  if (!navigator.share) {
    return 'unsupported'
  }

  // Strip codec params (e.g. "video/mp4;codecs=avc1,mp4a.40.2" → "video/mp4")
  // navigator.share rejects MIME types with codec parameters
  const baseType = blob.type.split(';')[0] || 'video/mp4'
  const ext = baseType === 'video/webm' ? '.webm' : baseType === 'audio/mpeg' ? '.mp3' : '.mp4'
  const correctedFilename = filename.replace(/\.[^.]+$/, ext)
  const file = new File([blob], correctedFilename, { type: baseType })

  // Some browsers have navigator.share but not canShare — just try sharing
  if (navigator.canShare && !navigator.canShare({ files: [file] })) {
    return 'unsupported'
  }

  try {
    await navigator.share({
      files: [file],
      title: 'My Guitar Practice',
      text: 'Check out my guitar practice!',
    })
    return 'shared'
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return 'cancelled'
    }
    return 'unsupported'
  }
}
