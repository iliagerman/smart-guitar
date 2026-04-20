import { useCallback, useEffect, useRef, useState } from 'react'

import { getAudioSourceGroupKey, getAudioSourceKey } from '../lib/audio-source'

interface BufferedStemMixerOptions {
  playbackRate: number
  setPlaying: (playing: boolean) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  onPlaybackError?: (message: string) => void
}

interface LoadedStemBuffer {
  name: string
  key: string
  buffer: AudioBuffer
  gain: GainNode
}

interface StemLoadOptions {
  shouldPlay: boolean
  startTime: number
  /** Initial per-stem volumes (0–1). Stems not listed default to 1. */
  stemVolumes?: Record<string, number>
}

interface RecordingTap {
  context: AudioContext
  node: GainNode
}

interface BufferedStemMixerResult {
  clear: () => void
  getRecordingTap: () => RecordingTap | null
  isLoading: boolean
  loadStems: (stemUrls: Map<string, string>, options: StemLoadOptions) => Promise<void>
  primeAudioContext: () => Promise<void>
  seek: (time: number) => void
  /** Instantly adjust a loaded stem's volume (0–1). No reload needed. */
  setStemVolume: (stemName: string, volume: number) => void
  togglePlay: () => Promise<void>
}

interface WebkitAudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext
}

const MIN_TIME_DELTA = 0.016

function formatMixerError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown buffered stem mixer error'
}

function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0
  if (duration <= 0) return Math.max(0, time)
  return Math.min(Math.max(0, time), duration)
}

function isResumableAudioContextState(state: AudioContextState): state is 'suspended' | 'interrupted' {
  return state === 'suspended' || state === 'interrupted'
}

/**
 * Client-side multi-stem mixer built on AudioBufferSourceNode.
 *
 * All selected stems are decoded in the browser and started from the same
 * AudioContext clock so mobile and desktop playback stay tightly synchronized.
 */
export function useBufferedStemMixer({
  playbackRate,
  setPlaying,
  setCurrentTime,
  setDuration,
  onPlaybackError,
}: BufferedStemMixerOptions): BufferedStemMixerResult {
  const activeStemsRef = useRef<Map<string, LoadedStemBuffer>>(new Map())
  const audioContextRef = useRef<AudioContext | null>(null)
  const bufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map())
  const cacheGroupKeyRef = useRef('')
  const inFlightLoadsRef = useRef<Map<string, Promise<AudioBuffer>>>(new Map())
  const intervalRef = useRef<number | null>(null)
  const isPlayingRef = useRef(false)
  const lastReportedTimeRef = useRef(0)
  const loadAbortRef = useRef<AbortController | null>(null)
  const loadRevisionRef = useRef(0)
  const rafRef = useRef<number>(0)
  const selectionKeyRef = useRef('')
  const sourceNodesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map())
  const startOffsetRef = useRef(0)
  const startedAtRef = useRef(0)
  const durationRef = useRef(0)
  const hasUnlockedAudioRef = useRef(false)
  const recordingTapRef = useRef<GainNode | null>(null)
  const silentStartCheckRef = useRef<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const getAudioContext = useCallback(() => {
    if (audioContextRef.current) {
      return audioContextRef.current
    }
    const AudioContextConstructor =
      window.AudioContext ?? (window as WebkitAudioWindow).webkitAudioContext
    if (!AudioContextConstructor) {
      throw new Error('Web Audio API is not supported in this browser')
    }
    audioContextRef.current = new AudioContextConstructor()
    return audioContextRef.current
  }, [])

  const unlockAudioDevice = useCallback(async (ctx: AudioContext) => {
    if (hasUnlockedAudioRef.current) {
      return
    }

    const silentBuffer = ctx.createBuffer(1, 1, ctx.sampleRate)
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    gain.gain.value = 0
    source.buffer = silentBuffer
    source.connect(gain)
    gain.connect(ctx.destination)
    source.start(0)
    source.stop(ctx.currentTime + 0.001)
    await new Promise<void>((resolve) => {
      source.onended = () => resolve()
    })
    source.disconnect()
    gain.disconnect()
    hasUnlockedAudioRef.current = true
  }, [])

  const primeAudioContext = useCallback(async () => {
    const ctx = getAudioContext()
    if (isResumableAudioContextState(ctx.state)) {
      try {
        await ctx.resume()
      } catch (error) {
        throw new Error(`AudioContext resume failed from ${ctx.state}: ${formatMixerError(error)}`)
      }
    }
    if (ctx.state !== 'running') {
      throw new Error(`Audio context is ${ctx.state}`)
    }
    try {
      await unlockAudioDevice(ctx)
    } catch (error) {
      throw new Error(`Audio device unlock failed: ${formatMixerError(error)}`)
    }
  }, [getAudioContext, unlockAudioDevice])

  const ensureRunningAudioContext = useCallback(async () => {
    const ctx = getAudioContext()
    if (isResumableAudioContextState(ctx.state)) {
      try {
        await ctx.resume()
      } catch (error) {
        throw new Error(`AudioContext resume failed from ${ctx.state}: ${formatMixerError(error)}`)
      }
    }
    if (ctx.state !== 'running') {
      throw new Error(`Audio context is ${ctx.state}`)
    }
    if (!hasUnlockedAudioRef.current) {
      try {
        await unlockAudioDevice(ctx)
      } catch (error) {
        throw new Error(`Audio device unlock failed: ${formatMixerError(error)}`)
      }
    }
    return ctx
  }, [getAudioContext, unlockAudioDevice])

  const getCurrentPosition = useCallback(() => {
    const duration = durationRef.current
    if (!isPlayingRef.current) {
      return clampTime(startOffsetRef.current, duration)
    }
    const ctx = getAudioContext()
    const elapsed = (ctx.currentTime - startedAtRef.current) * playbackRate
    return clampTime(startOffsetRef.current + elapsed, duration)
  }, [getAudioContext, playbackRate])

  const stopTimeLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (silentStartCheckRef.current) {
      window.clearTimeout(silentStartCheckRef.current)
      silentStartCheckRef.current = null
    }
  }, [])

  const stopSources = useCallback(() => {
    for (const source of sourceNodesRef.current.values()) {
      try {
        source.stop()
      } catch {
        // Source may already be stopped.
      }
      source.disconnect()
    }
    sourceNodesRef.current.clear()
  }, [])

  const reportCurrentTime = useCallback(() => {
    const time = getCurrentPosition()
    if (Math.abs(time - lastReportedTimeRef.current) < MIN_TIME_DELTA) {
      return
    }
    lastReportedTimeRef.current = time
    setCurrentTime(time)
  }, [getCurrentPosition, setCurrentTime])

  const pausePlayback = useCallback(() => {
    const time = getCurrentPosition()
    stopSources()
    stopTimeLoop()
    isPlayingRef.current = false
    startOffsetRef.current = time
    lastReportedTimeRef.current = time
    setPlaying(false)
    setCurrentTime(time)
  }, [getCurrentPosition, setCurrentTime, setPlaying, stopSources, stopTimeLoop])

  const clearActiveStems = useCallback(() => {
    for (const stem of activeStemsRef.current.values()) {
      stem.gain.disconnect()
    }
    activeStemsRef.current.clear()
    selectionKeyRef.current = ''
  }, [])

  const startTimeLoop = useCallback(() => {
    const tick = () => {
      if (!isPlayingRef.current) return
      const time = getCurrentPosition()
      if (durationRef.current > 0 && time >= durationRef.current) {
        stopSources()
        stopTimeLoop()
        isPlayingRef.current = false
        startOffsetRef.current = durationRef.current
        lastReportedTimeRef.current = durationRef.current
        setPlaying(false)
        setCurrentTime(durationRef.current)
        return
      }
      reportCurrentTime()
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    if (!intervalRef.current) {
      intervalRef.current = window.setInterval(() => {
        if (!isPlayingRef.current) return
        reportCurrentTime()
      }, 100)
    }
  }, [getCurrentPosition, reportCurrentTime, setCurrentTime, setPlaying, stopSources, stopTimeLoop])

  const startPlaybackFrom = useCallback(async (time: number) => {
    if (activeStemsRef.current.size === 0) return
    const ctx = await ensureRunningAudioContext()

    stopSources()

    const offset = clampTime(time, durationRef.current)
    if (durationRef.current > 0 && offset >= durationRef.current) {
      isPlayingRef.current = false
      startOffsetRef.current = durationRef.current
      lastReportedTimeRef.current = durationRef.current
      setPlaying(false)
      setCurrentTime(durationRef.current)
      return
    }

    startedAtRef.current = ctx.currentTime
    startOffsetRef.current = offset
    lastReportedTimeRef.current = offset

    for (const stem of activeStemsRef.current.values()) {
      const source = ctx.createBufferSource()
      source.buffer = stem.buffer
      source.playbackRate.value = playbackRate
      source.connect(stem.gain)
      source.start(0, clampTime(offset, stem.buffer.duration))
      sourceNodesRef.current.set(stem.name, source)
    }

    isPlayingRef.current = true
    setPlaying(true)
    setCurrentTime(offset)
    startTimeLoop()

    if (silentStartCheckRef.current) {
      window.clearTimeout(silentStartCheckRef.current)
    }
    silentStartCheckRef.current = window.setTimeout(() => {
      if (!isPlayingRef.current) {
        return
      }
      const current = getCurrentPosition()
      const delta = Math.abs(current - offset)
      if (delta < 0.05) {
        const ctxState = audioContextRef.current?.state ?? 'none'
        const selection = [...activeStemsRef.current.keys()].join(', ')
        onPlaybackError?.(
          `[DEBUG-TEMP] buffered stem silent start | ctx=${ctxState} unlocked=${hasUnlockedAudioRef.current} stems=${activeStemsRef.current.size} sources=${sourceNodesRef.current.size} offset=${offset.toFixed(3)} current=${current.toFixed(3)} duration=${durationRef.current.toFixed(3)} selection=[${selection}]`,
        )
      }
    }, 1200)
  }, [ensureRunningAudioContext, getCurrentPosition, onPlaybackError, playbackRate, setCurrentTime, setPlaying, startTimeLoop, stopSources])

  const ensureStemBuffer = useCallback(async (url: string, signal: AbortSignal) => {
    const key = getAudioSourceKey(url)
    const cached = bufferCacheRef.current.get(key)
    if (cached) {
      return { key, buffer: cached }
    }

    const existingLoad = inFlightLoadsRef.current.get(key)
    if (existingLoad) {
      const buffer = await existingLoad
      return { key, buffer }
    }

    const loadPromise = (async () => {
      const response = await fetch(url, { signal })
      if (!response.ok) {
        throw new Error(`Failed to fetch stem (${url}): ${response.status}`)
      }
      const data = await response.arrayBuffer()
      const ctx = getAudioContext()
      try {
        return await ctx.decodeAudioData(data.slice(0))
      } catch (error) {
        throw new Error(`decodeAudioData failed for ${url}: ${formatMixerError(error)}`)
      }
    })()

    inFlightLoadsRef.current.set(key, loadPromise)
    try {
      const buffer = await loadPromise
      bufferCacheRef.current.set(key, buffer)
      return { key, buffer }
    } finally {
      if (inFlightLoadsRef.current.get(key) === loadPromise) {
        inFlightLoadsRef.current.delete(key)
      }
    }
  }, [getAudioContext])

  const loadStems = useCallback(async (stemUrls: Map<string, string>, options: StemLoadOptions) => {
    const entries = [...stemUrls.entries()].sort(([left], [right]) => left.localeCompare(right))
    if (entries.length === 0) {
      clearActiveStems()
      pausePlayback()
      setDuration(0)
      setCurrentTime(0)
      return
    }

    const selectionKey = entries
      .map(([name, url]) => `${name}:${getAudioSourceKey(url)}`)
      .join('|')
    if (selectionKey === selectionKeyRef.current && activeStemsRef.current.size === entries.length) {
      return
    }

    const position = clampTime(options.startTime, durationRef.current || Number.MAX_SAFE_INTEGER)
    const shouldResume = options.shouldPlay
    pausePlayback()

    const nextGroupKey = getAudioSourceGroupKey(entries[0][1])
    if (cacheGroupKeyRef.current && cacheGroupKeyRef.current !== nextGroupKey) {
      bufferCacheRef.current.clear()
      inFlightLoadsRef.current.clear()
    }
    cacheGroupKeyRef.current = nextGroupKey

    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    const revision = loadRevisionRef.current + 1
    loadRevisionRef.current = revision
    setIsLoading(true)

    try {
      const loadedEntries = await Promise.all(
        entries.map(async ([name, url]) => {
          const loaded = await ensureStemBuffer(url, controller.signal)
          return { name, key: loaded.key, buffer: loaded.buffer }
        }),
      )

      if (controller.signal.aborted || loadRevisionRef.current !== revision) {
        return
      }

      const ctx = getAudioContext()
      clearActiveStems()

      // Create (or reuse) a recording tap node so the recorder can
      // receive a clean digital copy of the stem mix.
      if (!recordingTapRef.current) {
        recordingTapRef.current = ctx.createGain()
        recordingTapRef.current.gain.value = 1
      }

      const nextStems = new Map<string, LoadedStemBuffer>()
      const volumes = options.stemVolumes
      for (const entry of loadedEntries) {
        const gain = ctx.createGain()
        gain.gain.value = volumes?.[entry.name] ?? 1
        gain.connect(ctx.destination)
        gain.connect(recordingTapRef.current)
        nextStems.set(entry.name, {
          name: entry.name,
          key: entry.key,
          buffer: entry.buffer,
          gain,
        })
      }
      activeStemsRef.current = nextStems
      selectionKeyRef.current = selectionKey

      const duration = loadedEntries.reduce((max, entry) => Math.max(max, entry.buffer.duration), 0)
      durationRef.current = duration
      setDuration(duration)

      const offset = clampTime(position, duration)
      startOffsetRef.current = offset
      lastReportedTimeRef.current = offset
      setCurrentTime(offset)

      if (shouldResume) {
        await startPlaybackFrom(offset)
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }
      clearActiveStems()
      durationRef.current = 0
      setDuration(0)
      setCurrentTime(0)
      setPlaying(false)
      const selection = entries.map(([name]) => name).join(', ')
      onPlaybackError?.(`[DEBUG-TEMP] buffered stem load failed for [${selection}] | ctx=${audioContextRef.current?.state ?? 'none'} | ${formatMixerError(error)}`)
      throw error
    } finally {
      if (loadRevisionRef.current === revision) {
        setIsLoading(false)
      }
    }
  }, [clearActiveStems, ensureStemBuffer, getAudioContext, onPlaybackError, pausePlayback, setCurrentTime, setDuration, setPlaying, startPlaybackFrom])

  const togglePlay = useCallback(async () => {
    if (activeStemsRef.current.size === 0 || isLoading) return
    if (isPlayingRef.current) {
      pausePlayback()
      return
    }
    try {
      await startPlaybackFrom(startOffsetRef.current)
    } catch (error) {
      onPlaybackError?.(`[DEBUG-TEMP] buffered stem togglePlay failed | ctx=${audioContextRef.current?.state ?? 'none'} | ${formatMixerError(error)}`)
      throw error
    }
  }, [isLoading, onPlaybackError, pausePlayback, startPlaybackFrom])

  const seek = useCallback((time: number) => {
    const nextTime = clampTime(time, durationRef.current)
    startOffsetRef.current = nextTime
    lastReportedTimeRef.current = nextTime
    if (isPlayingRef.current) {
      void startPlaybackFrom(nextTime)
      return
    }
    setCurrentTime(nextTime)
  }, [setCurrentTime, startPlaybackFrom])

  const setStemVolume = useCallback((stemName: string, volume: number) => {
    const stem = activeStemsRef.current.get(stemName)
    if (!stem) return
    stem.gain.gain.value = Math.max(0, Math.min(1, volume))
  }, [])

  const getRecordingTap = useCallback((): RecordingTap | null => {
    const ctx = audioContextRef.current
    const tap = recordingTapRef.current
    if (!ctx || !tap) return null
    return { context: ctx, node: tap }
  }, [])

  const clear = useCallback(() => {
    loadAbortRef.current?.abort()
    loadAbortRef.current = null
    setIsLoading(false)
    pausePlayback()
    clearActiveStems()
    durationRef.current = 0
  }, [clearActiveStems, pausePlayback])

  useEffect(() => {
    if (!isPlayingRef.current || activeStemsRef.current.size === 0) {
      return
    }
    const time = getCurrentPosition()
    void startPlaybackFrom(time)
  }, [getCurrentPosition, playbackRate, startPlaybackFrom])

  useEffect(() => {
    const resumePlaybackIfNeeded = () => {
      const ctx = audioContextRef.current
      if (!ctx || !isPlayingRef.current || activeStemsRef.current.size === 0) {
        return
      }
      if (!isResumableAudioContextState(ctx.state)) {
        return
      }
      const time = getCurrentPosition()
      void startPlaybackFrom(time).catch((error) => {
        setPlaying(false)
        onPlaybackError?.(`[DEBUG-TEMP] buffered stem resume-after-visibility failed | ctx=${audioContextRef.current?.state ?? 'none'} | ${formatMixerError(error)}`)
      })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resumePlaybackIfNeeded()
      }
    }

    window.addEventListener('pageshow', resumePlaybackIfNeeded)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('pageshow', resumePlaybackIfNeeded)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      loadAbortRef.current?.abort()
      stopTimeLoop()
      stopSources()
      clearActiveStems()
      if (audioContextRef.current) {
        void audioContextRef.current.close()
        audioContextRef.current = null
      }
    }
  }, [clearActiveStems, getCurrentPosition, onPlaybackError, setPlaying, startPlaybackFrom, stopSources, stopTimeLoop])

  return { clear, getRecordingTap, isLoading, loadStems, primeAudioContext, seek, setStemVolume, togglePlay }
}
