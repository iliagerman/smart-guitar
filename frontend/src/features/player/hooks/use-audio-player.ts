import { useCallback, useEffect, useRef, useState } from 'react'

import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'

import { useBufferedStemMixer } from './use-buffered-stem-mixer'
import { isSameAudioSource } from '../lib/audio-source'
import { getLoopSeekTarget } from '../lib/ab-loop'
import {
  computeInstrumentalGaps,
  getSkipTarget,
  INSTRUMENTAL_SKIP_GRACE_SECONDS,
  INSTRUMENTAL_SKIP_PREROLL_SECONDS,
  MIN_INSTRUMENTAL_GAP_SECONDS,
  type InstrumentalGap,
  type LyricsTimeSegment,
} from '../lib/instrumental-gaps'

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
  /** Called once each time playback auto-skips an instrumental gap. */
  onInstrumentalSkip?: () => void
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
    onPlaybackError?.(`Could not start playback (${context}): ${formatPlaybackError(error)} | ${getMediaErrorDetails(audio)}`)
  }
}

// Throttle currentTime updates to ~20Hz (see use-buffered-stem-mixer for rationale).
const MIN_TIME_DELTA = 0.05

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
export function useAudioPlayer({
  onPlaybackError,
  onInstrumentalSkip,
}: UseAudioPlayerOptions = {}) {
  const singleTrackRef = useRef<SingleTrackState | null>(null)
  const modeRef = useRef<PlaybackMode>('idle')
  const intervalRef = useRef<number | null>(null)
  const animFrameRef = useRef<number>(0)
  const lastReportedTimeRef = useRef(0)
  // True while we briefly play+pause muted to unlock the element for a delayed
  // start (count-in). The play/pause event handlers no-op during this window so
  // store state (isPlaying / currentTime) is not disturbed.
  const primingRef = useRef(false)
  // Last instrumental-skip target we actually seeked to, so the enforcement
  // loop doesn't re-fire on every frame while the store's currentTime is
  // still catching up to a seek that landed inside the same gap (the
  // multi-stem path in particular updates currentTime asynchronously).
  const lastSkipTargetRef = useRef<number | null>(null)
  // Start time of an instrumental gap the user has deliberately scrubbed
  // into — auto-skip is suppressed for that gap until playback exits it.
  const suppressedGapStartRef = useRef<number | null>(null)

  const isPlaying = usePlaybackStore((state) => state.isPlaying)
  const playbackRate = usePlaybackStore((state) => state.playbackRate)
  const setPlaying = usePlaybackStore((state) => state.setPlaying)
  const setCurrentTime = usePlaybackStore((state) => state.setCurrentTime)
  const setDuration = usePlaybackStore((state) => state.setDuration)
  const skipInstrumentals = usePlayerPrefsStore((state) => state.skipInstrumentals)
  const [instrumentalGaps, setInstrumentalGaps] = useState<InstrumentalGap[]>([])

  /**
   * Recomputes the skippable instrumental gaps from the active sheet
   * version's sung lyrics segments. Called imperatively (via effect) once
   * the caller has resolved which lyrics are active — this hook is set up
   * before the song's `detail` (and therefore its lyrics) has loaded.
   * Pass an empty array when the active version's lyrics aren't synced to
   * keep the feature inert.
   */
  const setInstrumentalGapSegments = useCallback((segments: LyricsTimeSegment[]) => {
    setInstrumentalGaps(computeInstrumentalGaps(segments, MIN_INSTRUMENTAL_GAP_SECONDS))
  }, [])

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
      if (primingRef.current) return
      setPlaying(true)
      lastReportedTimeRef.current = audio.currentTime
      setCurrentTime(audio.currentTime)
      startSingleTimeLoop()
    }
    audio.onpause = () => {
      if (primingRef.current) return
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
      onPlaybackError?.(`Could not load audio source: ${getMediaErrorDetails(audio)} | src=${audio.currentSrc || url}`)
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
      onPlaybackError?.(`Could not load stem audio: ${formatPlaybackError(error)}`)
    })
  }, [destroySingleTrack, loadBufferedStems, onPlaybackError, setPlaying])

  const loadFullSong = useCallback((url: string, options?: LoadSingleTrackOptions) => {
    modeRef.current = 'single'
    loadSingleTrack(url, options)
  }, [loadSingleTrack])

  const togglePlay = useCallback(() => {
    if (modeRef.current === 'multi') {
      void toggleBufferedStems().catch((error) => {
        onPlaybackError?.(`Could not toggle stem playback: ${formatPlaybackError(error)}`)
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

  // Does the actual seek, single-track or multi-stem. Used both by the
  // public `seek()` below (user-initiated) and by the enforcement loop
  // (A/B loop wrap, auto-skip) — the latter must bypass the suppression
  // bookkeeping in `seek()`, since an enforcement seek is never a "user
  // scrubbed into this gap on purpose" signal.
  const performSeek = useCallback((time: number) => {
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

  /**
   * User-initiated seek (progress bar, keyboard arrows, tap-to-seek). If the
   * landing point falls inside a skippable instrumental gap, that gap is
   * suppressed from auto-skip until playback later exits its bounds — a
   * deliberate scrub into a solo shouldn't be immediately skipped back out.
   */
  const seek = useCallback((time: number) => {
    const landingGap = instrumentalGaps.find((gap) => time >= gap.start && time < gap.end)
    suppressedGapStartRef.current = landingGap ? landingGap.start : null
    performSeek(time)
  }, [performSeek, instrumentalGaps])

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

  // A/B loop + instrumental-skip enforcement: mode-agnostic, reads store state
  // directly each frame (no subscription) so it doesn't add re-renders, and
  // uses `performSeek()` (not the public `seek()`) so these enforcement-driven
  // jumps never count as a user seek for gap-suppression purposes. The loop
  // takes precedence — a user looping a solo on purpose must not have it
  // skipped out from under them.
  useEffect(() => {
    // Both A/B-loop wrap and instrumental skip only act during playback, so the
    // 60fps loop is pure waste (and a phone heater) while paused. Restart it
    // when playback resumes.
    if (!isPlaying) return
    let frameId: number
    const tick = () => {
      const playback = usePlaybackStore.getState()
      const loopTarget = getLoopSeekTarget(playback)
      if (loopTarget !== null) {
        performSeek(loopTarget)
        lastSkipTargetRef.current = null
      } else {
        const hasActiveLoop = playback.loopStart !== null && playback.loopEnd !== null
        if (skipInstrumentals && playback.isPlaying && !hasActiveLoop) {
          // Once playback has left the suppressed gap's bounds — by playing
          // through it or by a later user seek — the suppression lapses so
          // a *future* natural entry into that same gap can still be skipped.
          const suppressedGap = instrumentalGaps.find((gap) => gap.start === suppressedGapStartRef.current)
          const stillInsideSuppressedGap =
            suppressedGap !== undefined &&
            playback.currentTime >= suppressedGap.start &&
            playback.currentTime < suppressedGap.end
          if (!stillInsideSuppressedGap) {
            suppressedGapStartRef.current = null
          }

          const skipTarget = getSkipTarget(
            instrumentalGaps,
            playback.currentTime,
            { graceSeconds: INSTRUMENTAL_SKIP_GRACE_SECONDS, preRollSeconds: INSTRUMENTAL_SKIP_PREROLL_SECONDS },
            suppressedGapStartRef.current,
          )
          if (skipTarget !== null) {
            // Skip only once per distinct target — the multi-stem path's
            // seek->startPlaybackFrom is async and doesn't update the
            // store's currentTime until it resumes the audio context, so
            // several frames can elapse with a still-stale, still-in-gap
            // currentTime that would otherwise recompute the same target
            // and re-seek/re-toast on every one of them.
            if (skipTarget !== lastSkipTargetRef.current) {
              lastSkipTargetRef.current = skipTarget
              performSeek(skipTarget)
              onInstrumentalSkip?.()
            }
          } else {
            lastSkipTargetRef.current = null
          }
        } else {
          lastSkipTargetRef.current = null
        }
      }
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [isPlaying, performSeek, skipInstrumentals, instrumentalGaps, onInstrumentalSkip])

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
      onPlaybackError?.(`Could not prepare audio playback: ${formatPlaybackError(error)}`)
    })
  }, [onPlaybackError, primeAudioContext])

  /**
   * Unlock the single-track element inside the user gesture so a delayed start
   * (after a count-in) is allowed on mobile browsers, which only permit playback
   * that originates from a gesture. We briefly play+pause muted; the multi-stem
   * mixer is already unlocked by prepareForPlaybackGesture's silent buffer.
   */
  const primeForDelayedStart = useCallback(() => {
    if (modeRef.current !== 'single') return
    const audio = singleTrackRef.current?.audio
    if (!audio || !audio.paused) return
    primingRef.current = true
    const wasMuted = audio.muted
    // eslint-disable-next-line react-hooks/immutability
    audio.muted = true
    void audio
      .play()
      .then(() => audio.pause())
      .catch(() => {
        // Best effort: if the unlock play is rejected, the real post-count-in
        // play() will surface the error through its own handler.
      })
      .finally(() => {
        audio.muted = wasMuted
        primingRef.current = false
      })
  }, [])

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
    primeForDelayedStart,
    setInstrumentalGapSegments,
  }
}
