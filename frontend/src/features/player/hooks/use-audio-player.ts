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
    if (a.hostname.includes('.s3.') || a.hostname.includes('.amazonaws.com')) return true
    return a.search === b.search
  } catch {
    return false
  }
}

interface StemChannel {
  audio: HTMLAudioElement
  source: MediaElementAudioSourceNode
  gain: GainNode
  url: string
}

/**
 * Multi-stem audio player using Web Audio API.
 *
 * Manages N HTMLAudioElements, each routed through a MediaElementSourceNode → GainNode
 * into a shared AudioContext. The first channel ("primary") drives time/duration updates
 * to the playback store.
 */
export function useAudioPlayer() {
  const channelsRef = useRef<Map<string, StemChannel>>(new Map())
  const audioContextRef = useRef<AudioContext | null>(null)
  const intervalRef = useRef<number | null>(null)
  const lastReportedTimeRef = useRef(0)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const playbackRate = usePlaybackStore((s) => s.playbackRate)
  const setPlaying = usePlaybackStore((s) => s.setPlaying)
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime)
  const setDuration = usePlaybackStore((s) => s.setDuration)

  // Lazily get or create the AudioContext
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    return audioContextRef.current
  }, [])

  // Get the primary channel (first one in the map) for time reporting
  const getPrimary = useCallback((): StemChannel | undefined => {
    const channels = channelsRef.current
    return channels.values().next().value as StemChannel | undefined
  }, [])

  // --- Time reporting (rAF + interval fallback) ---
  const animFrameRef = useRef<number>(0)
  const MIN_TIME_DELTA = 0.016

  const reportTime = useCallback((audio: HTMLAudioElement) => {
    if (audio.seeking) return
    const t = audio.currentTime
    if (Math.abs(t - lastReportedTimeRef.current) >= MIN_TIME_DELTA) {
      lastReportedTimeRef.current = t
      setCurrentTime(t)
    }
  }, [setCurrentTime])

  const startTimeLoop = useCallback(() => {
    const updateTime = () => {
      const primary = getPrimary()
      if (primary && !primary.audio.paused) {
        reportTime(primary.audio)
        animFrameRef.current = requestAnimationFrame(updateTime)
      }
    }
    animFrameRef.current = requestAnimationFrame(updateTime)

    // Fallback interval for background tabs
    if (!intervalRef.current) {
      intervalRef.current = window.setInterval(() => {
        const primary = getPrimary()
        if (primary && !primary.audio.paused) {
          reportTime(primary.audio)
        }
      }, 100)
    }
  }, [getPrimary, reportTime])

  const stopTimeLoop = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  // --- Channel lifecycle ---

  const createChannel = useCallback((name: string, url: string, seekTo: number, shouldPlay: boolean): StemChannel => {
    const ctx = getAudioContext()
    const audio = new Audio()
    audio.crossOrigin = 'anonymous'
    const source = ctx.createMediaElementSource(audio)
    const gain = ctx.createGain()
    gain.gain.value = 1
    source.connect(gain)
    gain.connect(ctx.destination)

    audio.playbackRate = usePlaybackStore.getState().playbackRate
    audio.src = url

    const onMetadata = () => {
      audio.currentTime = seekTo
      // Report duration from the first channel that loads
      if (channelsRef.current.values().next().value === channel) {
        setDuration(audio.duration || 0)
      }
      if (shouldPlay) {
        audio.play().catch(() => { setPlaying(false) })
      }
      audio.removeEventListener('loadedmetadata', onMetadata)
    }
    audio.addEventListener('loadedmetadata', onMetadata)

    const channel: StemChannel = { audio, source, gain, url }
    return channel
  }, [getAudioContext, setDuration, setPlaying])

  const destroyChannel = useCallback((channel: StemChannel) => {
    channel.audio.pause()
    channel.audio.src = ''
    channel.gain.disconnect()
    channel.source.disconnect()
  }, [])

  const destroyAllChannels = useCallback(() => {
    for (const ch of channelsRef.current.values()) {
      destroyChannel(ch)
    }
    channelsRef.current.clear()
  }, [destroyChannel])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroyAllChannels()
      stopTimeLoop()
      if (audioContextRef.current) {
        void audioContextRef.current.close()
        audioContextRef.current = null
      }
    }
  }, [destroyAllChannels, stopTimeLoop])

  // Sync playback rate across all channels
  useEffect(() => {
    for (const ch of channelsRef.current.values()) {
      ch.audio.playbackRate = playbackRate
    }
  }, [playbackRate])

  // --- Helpers ---

  // Attach play/pause/ended/seeked listeners to the primary channel
  const setupPrimaryEvents = useCallback(() => {
    const primary = getPrimary()
    if (!primary) return

    const audio = primary.audio

    const handlePlay = () => {
      setPlaying(true)
      lastReportedTimeRef.current = audio.currentTime
      setCurrentTime(audio.currentTime)
      startTimeLoop()
    }
    const handlePause = () => {
      setPlaying(false)
      stopTimeLoop()
      setCurrentTime(audio.currentTime)
    }
    const handleEnded = () => {
      setPlaying(false)
      stopTimeLoop()
    }
    const handleSeeked = () => {
      const t = audio.currentTime
      lastReportedTimeRef.current = t
      setCurrentTime(t)
    }
    const handleTimeUpdate = () => {
      if (audio.seeking) return
      reportTime(audio)
    }
    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0)
    }

    audio.onplay = handlePlay
    audio.onpause = handlePause
    audio.onended = handleEnded
    audio.onseeked = handleSeeked
    audio.ontimeupdate = handleTimeUpdate
    audio.onloadedmetadata = handleLoadedMetadata
  }, [getPrimary, setPlaying, setCurrentTime, setDuration, startTimeLoop, stopTimeLoop, reportTime])

  // --- Public API ---

  /**
   * Load multiple stems simultaneously. Diffs against current channels:
   * keeps matching ones, creates new ones, removes old ones.
   */
  const loadStems = useCallback((stemUrls: Map<string, string>) => {
    const channels = channelsRef.current
    const primary = getPrimary()
    // Use store time (reset to 0 on song change) rather than audio element time,
    // so switching songs always starts from the beginning.
    const currentTime = usePlaybackStore.getState().currentTime
    const wasPlaying = primary ? !primary.audio.paused : false

    // Remove channels no longer needed
    for (const [name, ch] of channels) {
      if (!stemUrls.has(name)) {
        destroyChannel(ch)
        channels.delete(name)
      }
    }

    // Add or update channels
    for (const [name, url] of stemUrls) {
      const existing = channels.get(name)
      if (existing && isSameAudioSource(existing.audio.src, url)) {
        continue // Already loaded
      }
      if (existing) {
        destroyChannel(existing)
      }
      const ch = createChannel(name, url, currentTime, wasPlaying)
      channels.set(name, ch)
    }

    // Wire play/pause/ended events on new primary
    setupPrimaryEvents()
  }, [getPrimary, destroyChannel, createChannel, setupPrimaryEvents])

  /**
   * Load a single full-song URL (original MP3). Clears all stem channels.
   */
  const loadFullSong = useCallback((url: string) => {
    const channels = channelsRef.current
    const primary = getPrimary()

    // If already playing this exact URL, skip
    if (channels.size === 1) {
      const only = channels.values().next().value as StemChannel
      if (only && isSameAudioSource(only.audio.src, url)) return
    }

    const currentTime = usePlaybackStore.getState().currentTime
    const wasPlaying = primary ? !primary.audio.paused : false

    destroyAllChannels()
    const ch = createChannel('__full__', url, currentTime, wasPlaying)
    channels.set('__full__', ch)

    setupPrimaryEvents()
  }, [getPrimary, destroyAllChannels, createChannel, setupPrimaryEvents])

  const togglePlay = useCallback(() => {
    const channels = channelsRef.current
    if (channels.size === 0) return

    const ctx = getAudioContext()
    if (ctx.state === 'suspended') {
      void ctx.resume()
    }

    const primary = getPrimary()
    if (!primary) return

    if (primary.audio.paused) {
      for (const ch of channels.values()) {
        ch.audio.play().catch(() => { })
      }
      setPlaying(true)
    } else {
      for (const ch of channels.values()) {
        ch.audio.pause()
      }
      setPlaying(false)
    }
  }, [getAudioContext, getPrimary, setPlaying])

  const seek = useCallback((time: number) => {
    for (const ch of channelsRef.current.values()) {
      ch.audio.currentTime = time
    }
    lastReportedTimeRef.current = time
    setCurrentTime(time)
  }, [setCurrentTime])

  // Legacy single-track loader for backward compat during transition
  const loadTrack = useCallback((url: string) => {
    const m = new Map<string, string>()
    m.set('__single__', url)
    loadStems(m)
  }, [loadStems])

  return { loadTrack, loadStems, loadFullSong, togglePlay, seek, isPlaying }
}
