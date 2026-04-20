import { useCallback, useEffect, useRef } from 'react'

import { usePlaybackStore } from '@/stores/playback.store'

import { useBufferedStemMixer } from './use-buffered-stem-mixer'
import { isSameAudioSource } from '../lib/audio-source'

type PlaybackMode = 'idle' | 'single' | 'multi'

interface SingleTrackState {
  audio: HTMLAudioElement
  url: string
}

interface LoadSingleTrackOptions {
  shouldPlay?: boolean
}

interface UseAudioPlayerOptions {
  onPlaybackError?: (message: string) => void
}

function formatPlaybackError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown playback error'
}

function getMediaErrorDetails(audio: HTMLAudioElement): string {
  if (!audio.error) {
    return `readyState=${audio.readyState} networkState=${audio.networkState}`
  }

  const codeMap: Record<number, string> = {
    1: 'MEDIA_ERR_ABORTED',
    2: 'MEDIA_ERR_NETWORK',
    3: 'MEDIA_ERR_DECODE',
    4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
  }

  const code = audio.error.code
  const label = codeMap[code] ?? `MEDIA_ERR_${code}`
  return `${label}; readyState=${audio.readyState} networkState=${audio.networkState}`
}

async function playAudio(
  audio: HTMLAudioElement,
  setPlaying: (playing: boolean) => void,
  onPlaybackError: ((message: string) => void) | undefined,
  context: string,
): Promise<void> {
  try {
    await audio.play()
  } catch (error) {
    setPlaying(false)
    onPlaybackError?.(`[DEBUG-TEMP] audio.play() failed (${context}): ${formatPlaybackError(error)} | ${getMediaErrorDetails(audio)}`)
  }
}

const MIN_TIME_DELTA = 0.016

function setAudioCurrentTime(audio: HTMLAudioElement, time: number): number {
  audio.currentTime = clampTime(time, audio.duration || 0)
  return audio.currentTime
}

function setAudioPlaybackRate(audio: HTMLAudioElement, playbackRate: number): void {
  audio.playbackRate = playbackRate
}

function resetAudioElement(audio: HTMLAudioElement, unload = false): void {
  audio.pause()
  audio.onplay = null
  audio.onpause = null
  audio.onended = null
  audio.onseeked = null
  audio.ontimeupdate = null
  audio.onloadedmetadata = null
  audio.oncanplay = null
  audio.onerror = null
  if (unload) {
    audio.src = ''
    audio.load()
  }
}

function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0
  if (duration <= 0) return Math.max(0, time)
  return Math.min(Math.max(0, time), duration)
}

/**
 * Playback controller for the song page.
 *
 * Single-file playback uses one HTMLAudioElement. Multi-stem playback uses a
 * client-side Web Audio mixer so selected stems stay synchronized on mobile and desktop.
 */
export function useAudioPlayer({ onPlaybackError }: UseAudioPlayerOptions = {}) {
  const singleTrackRef = useRef<SingleTrackState | null>(null)
  const modeRef = useRef<PlaybackMode>('idle')
  const intervalRef = useRef<number | null>(null)
  const animFrameRef = useRef<number>(0)
  const lastReportedTimeRef = useRef(0)

  const isPlaying = usePlaybackStore((state) => state.isPlaying)
  const playbackRate = usePlaybackStore((state) => state.playbackRate)
  const setPlaying = usePlaybackStore((state) => state.setPlaying)
  const setCurrentTime = usePlaybackStore((state) => state.setCurrentTime)
  const setDuration = usePlaybackStore((state) => state.setDuration)

  const {
    clear: clearBufferedStems,
    getRecordingTap,
    isLoading,
    loadStems: loadBufferedStems,
    primeAudioContext,
    seek: seekBufferedStems,
    setStemVolume,
    togglePlay: toggleBufferedStems,
  } = useBufferedStemMixer({
    playbackRate,
    setPlaying,
    setCurrentTime,
    setDuration,
    onPlaybackError,
  })

  const reportSingleTrackTime = useCallback(() => {
    const audio = singleTrackRef.current?.audio
    if (!audio || audio.seeking) return
    const time = audio.currentTime
    if (Math.abs(time - lastReportedTimeRef.current) < MIN_TIME_DELTA) return
    lastReportedTimeRef.current = time
    setCurrentTime(time)
  }, [setCurrentTime])

  const stopSingleTimeLoop = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const startSingleTimeLoop = useCallback(() => {
    const tick = () => {
      const audio = singleTrackRef.current?.audio
      if (!audio || audio.paused) return
      reportSingleTrackTime()
      animFrameRef.current = requestAnimationFrame(tick)
    }

    animFrameRef.current = requestAnimationFrame(tick)
    if (!intervalRef.current) {
      intervalRef.current = window.setInterval(() => {
        const audio = singleTrackRef.current?.audio
        if (!audio || audio.paused) return
        reportSingleTrackTime()
      }, 100)
    }
  }, [reportSingleTrackTime])

  const destroySingleTrack = useCallback(() => {
    const singleTrack = singleTrackRef.current
    if (!singleTrack) return
    const { audio } = singleTrack
    stopSingleTimeLoop()
    resetAudioElement(audio, true)
    singleTrackRef.current = null
  }, [stopSingleTimeLoop])

  const loadSingleTrack = useCallback((url: string, options?: LoadSingleTrackOptions) => {
    const existingTrack = singleTrackRef.current
    if (modeRef.current === 'single' && existingTrack && isSameAudioSource(existingTrack.url, url)) {
      return
    }

    const currentTime = usePlaybackStore.getState().currentTime
    const shouldPlay = options?.shouldPlay ?? (
      existingTrack
        ? !existingTrack.audio.paused
        : usePlaybackStore.getState().isPlaying
    )

    modeRef.current = 'single'
    clearBufferedStems()

    const audio = existingTrack?.audio ?? new Audio()
    stopSingleTimeLoop()
    resetAudioElement(audio)
    // eslint-disable-next-line react-hooks/immutability
    audio.crossOrigin = 'anonymous'
    setAudioPlaybackRate(audio, playbackRate)
    audio.preload = 'auto'

    audio.onplay = () => {
      setPlaying(true)
      lastReportedTimeRef.current = audio.currentTime
      setCurrentTime(audio.currentTime)
      startSingleTimeLoop()
    }
    audio.onpause = () => {
      setPlaying(false)
      stopSingleTimeLoop()
      setCurrentTime(audio.currentTime)
    }
    audio.onended = () => {
      setPlaying(false)
      stopSingleTimeLoop()
      lastReportedTimeRef.current = audio.duration || 0
      setCurrentTime(audio.duration || 0)
    }
    audio.onseeked = () => {
      lastReportedTimeRef.current = audio.currentTime
      setCurrentTime(audio.currentTime)
    }
    audio.ontimeupdate = reportSingleTrackTime
    let hasStartedPlayback = false

    audio.onloadedmetadata = () => {
      const duration = audio.duration || 0
      setDuration(duration)
      const nextTime = setAudioCurrentTime(audio, currentTime)
      lastReportedTimeRef.current = nextTime
      setCurrentTime(nextTime)
    }
    audio.oncanplay = () => {
      if (!shouldPlay || hasStartedPlayback) return
      hasStartedPlayback = true
      void playAudio(audio, setPlaying, onPlaybackError, 'source swap auto-play')
    }
    audio.onerror = () => {
      onPlaybackError?.(`[DEBUG-TEMP] audio element error while loading source: ${getMediaErrorDetails(audio)} | src=${audio.currentSrc || url}`)
    }

    audio.src = url
    audio.load()
    singleTrackRef.current = { audio, url }
  }, [clearBufferedStems, onPlaybackError, playbackRate, reportSingleTrackTime, setCurrentTime, setDuration, setPlaying, startSingleTimeLoop, stopSingleTimeLoop])

  const loadStems = useCallback((stemUrls: Map<string, string>, stemVolumes?: Record<string, number>) => {
    const currentTime = usePlaybackStore.getState().currentTime
    const shouldPlay = modeRef.current === 'single'
      ? !(singleTrackRef.current?.audio.paused ?? true)
      : usePlaybackStore.getState().isPlaying

    modeRef.current = 'multi'
    destroySingleTrack()
    void loadBufferedStems(stemUrls, { shouldPlay, startTime: currentTime, stemVolumes }).catch((error) => {
      setPlaying(false)
      onPlaybackError?.(`[DEBUG-TEMP] buffered stem load failed: ${formatPlaybackError(error)}`)
    })
  }, [destroySingleTrack, loadBufferedStems, onPlaybackError, setPlaying])

  const loadFullSong = useCallback((url: string, options?: LoadSingleTrackOptions) => {
    modeRef.current = 'single'
    loadSingleTrack(url, options)
  }, [loadSingleTrack])

  const togglePlay = useCallback(() => {
    if (modeRef.current === 'multi') {
      void toggleBufferedStems().catch((error) => {
        onPlaybackError?.(`[DEBUG-TEMP] multi-stem toggle from useAudioPlayer failed: ${formatPlaybackError(error)}`)
      })
      return
    }

    const audio = singleTrackRef.current?.audio
    if (!audio) return
    if (audio.paused) {
      void playAudio(audio, setPlaying, onPlaybackError, 'manual toggle play')
      return
    }
    audio.pause()
  }, [onPlaybackError, setPlaying, toggleBufferedStems])

  const seek = useCallback((time: number) => {
    if (modeRef.current === 'multi') {
      seekBufferedStems(time)
      return
    }

    const audio = singleTrackRef.current?.audio
    if (!audio) return
    const nextTime = setAudioCurrentTime(audio, time)
    lastReportedTimeRef.current = nextTime
    setCurrentTime(nextTime)
  }, [seekBufferedStems, setCurrentTime])

  useEffect(() => {
    const audio = singleTrackRef.current?.audio
    if (!audio) return
    setAudioPlaybackRate(audio, playbackRate)
  }, [playbackRate])

  useEffect(() => {
    return () => {
      clearBufferedStems()
      destroySingleTrack()
    }
  }, [clearBufferedStems, destroySingleTrack])

  const pauseCurrent = useCallback(() => {
    if (modeRef.current === 'multi') {
      return
    }

    const audio = singleTrackRef.current?.audio
    if (!audio) return
    audio.pause()
    stopSingleTimeLoop()
    setPlaying(false)
  }, [setPlaying, stopSingleTimeLoop])

  const clear = useCallback(() => {
    modeRef.current = 'idle'
    clearBufferedStems()
    destroySingleTrack()
    setPlaying(false)
  }, [clearBufferedStems, destroySingleTrack, setPlaying])

  const loadTrack = useCallback((url: string) => {
    loadSingleTrack(url)
  }, [loadSingleTrack])

  const prepareForPlaybackGesture = useCallback(() => {
    void primeAudioContext().catch((error) => {
      onPlaybackError?.(`[DEBUG-TEMP] prepareForPlaybackGesture failed: ${formatPlaybackError(error)}`)
    })
  }, [onPlaybackError, primeAudioContext])

  return {
    clear,
    getRecordingTap,
    pauseCurrent,
    loadTrack,
    loadStems,
    loadFullSong,
    togglePlay,
    seek,
    setStemVolume,
    isPlaying,
    isLoading,
    prepareForPlaybackGesture,
  }
}
