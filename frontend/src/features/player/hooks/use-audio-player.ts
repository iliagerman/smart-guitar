import { useRef, useCallback, useEffect } from 'react'
import { usePlaybackStore } from '@/stores/playback.store'

/**
 * Test whether two URLs point to the same audio resource.
 * S3 presigned URLs rotate their query params (signature, expiry) on every
 * backend response while the underlying file (origin + pathname) stays the same.
 * For non-S3 URLs (local dev API), query params like ?stem=vocals matter.
 */
function isSameAudioSource(currentSrc: string, newUrl: string): boolean {
  if (!currentSrc || !newUrl) return false
  if (currentSrc === newUrl) return true
  try {
    const a = new URL(currentSrc)
    const b = new URL(newUrl, window.location.href)
    if (a.origin !== b.origin || a.pathname !== b.pathname) return false
    // S3 presigned URLs rotate query params (signature, expiry) on every
    // backend response while the underlying file stays the same.
    // Different stems always have different pathnames on S3, so if we get
    // here (same origin + pathname) it's the same file.
    if (a.hostname.includes('.s3.') || a.hostname.includes('.amazonaws.com')) return true
    // Non-S3 URLs (e.g. local API on a different port): query params
    // distinguish stems (?stem=vocals vs ?stem=vocals_guitar).
    return a.search === b.search
  } catch {
    return false
  }
}

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const intervalRef = useRef<number | null>(null)
  // Promoted to a ref so that seek() can update it and prevent the rAF loop
  // from pushing a stale time on the next frame after a seek.
  const lastReportedTimeRef = useRef(0)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const playbackRate = usePlaybackStore((s) => s.playbackRate)
  const setPlaying = usePlaybackStore((s) => s.setPlaying)
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime)
  const setDuration = usePlaybackStore((s) => s.setDuration)

  useEffect(() => {
    const audio = new Audio()
    audioRef.current = audio
    // Initial playback rate is set here, but updates are handled by the second useEffect
    // to avoid recreating the audio element when playbackRate changes.
    audio.playbackRate = usePlaybackStore.getState().playbackRate

    // Use requestAnimationFrame for smoother time updates when playing.
    // Only push to the store when the time has changed by at least 16ms
    // to avoid unnecessary re-renders.
    let animationFrameId: number
    const MIN_TIME_DELTA = 0.016 // ~16ms

    const updateTime = () => {
      if (!audio.paused) {
        // Skip reporting while the browser is actively seeking — audio.currentTime
        // still reflects the OLD position until the seek completes, which would
        // overwrite the store with stale data and desync the UI.
        if (!audio.seeking) {
          const t = audio.currentTime
          if (Math.abs(t - lastReportedTimeRef.current) >= MIN_TIME_DELTA) {
            lastReportedTimeRef.current = t
            setCurrentTime(t)
          }
        }
        animationFrameId = requestAnimationFrame(updateTime)
      }
    }

    const startIntervalFallback = () => {
      if (intervalRef.current) return
      // Fallback for cases where requestAnimationFrame is throttled (e.g. background tab)
      // or not running consistently. Keeps highlight updates responsive.
      intervalRef.current = window.setInterval(() => {
        if (audio.paused || audio.seeking) return
        const t = audio.currentTime
        if (Math.abs(t - lastReportedTimeRef.current) >= MIN_TIME_DELTA) {
          lastReportedTimeRef.current = t
          setCurrentTime(t)
        }
      }, 100)
    }

    const stopIntervalFallback = () => {
      if (!intervalRef.current) return
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    const handlePlay = () => {
      setPlaying(true)
      // Report immediately so UI doesn't wait for the first animation frame.
      lastReportedTimeRef.current = audio.currentTime
      setCurrentTime(lastReportedTimeRef.current)
      animationFrameId = requestAnimationFrame(updateTime)
      startIntervalFallback()
    }

    const handlePause = () => {
      setPlaying(false)
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
      setCurrentTime(audio.currentTime)
      stopIntervalFallback()
    }

    const handleTimeUpdate = () => {
      // Skip while seeking to avoid reporting stale positions.
      if (audio.seeking) return
      const t = audio.currentTime
      if (Math.abs(t - lastReportedTimeRef.current) >= MIN_TIME_DELTA) {
        lastReportedTimeRef.current = t
        setCurrentTime(t)
      }
    }

    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0)
    }

    const handleSeeked = () => {
      // Fires once when the browser finishes seeking. Report the actual
      // position to guarantee the store is in sync, even if rAF or
      // timeupdate missed it during the seek transition.
      const t = audio.currentTime
      lastReportedTimeRef.current = t
      setCurrentTime(t)
    }

    const handleEnded = () => {
      setPlaying(false)
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
      stopIntervalFallback()
    }

    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('seeked', handleSeeked)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('seeked', handleSeeked)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('ended', handleEnded)
      audio.pause()
      audio.src = ''
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
      stopIntervalFallback()
    }
  }, [setCurrentTime, setDuration, setPlaying]) // Removed playbackRate from here to avoid recreating audio element

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate
    }
  }, [playbackRate])

  const loadTrack = useCallback((url: string) => {
    const audio = audioRef.current
    if (!audio) return
    // Skip reload if the audio element is already playing this source.
    // Compare by origin + pathname only for S3 presigned URLs whose query
    // params (signature, expiry) rotate on every backend response.
    if (isSameAudioSource(audio.src, url)) return
    const currentTime = audio.currentTime
    const wasPlaying = !audio.paused
    audio.src = url

    // Wait for metadata before seeking — setting currentTime before
    // loadedmetadata is silently ignored by the browser.
    const resume = () => {
      audio.currentTime = currentTime
      lastReportedTimeRef.current = currentTime
      setCurrentTime(currentTime)
      if (wasPlaying) {
        audio.play().catch(() => { })
      }
      audio.removeEventListener('loadedmetadata', resume)
    }
    audio.addEventListener('loadedmetadata', resume)
  }, [setCurrentTime])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play().catch(() => { })
      setPlaying(true)
    } else {
      audio.pause()
      setPlaying(false)
    }
  }, [setPlaying])

  const seek = useCallback((time: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = time
    lastReportedTimeRef.current = time
    setCurrentTime(time)
  }, [setCurrentTime])

  return { audioRef, loadTrack, togglePlay, seek, isPlaying }
}
