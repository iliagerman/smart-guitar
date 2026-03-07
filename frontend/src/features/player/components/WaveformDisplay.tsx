import { useEffect, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { usePlaybackStore } from '@/stores/playback.store'

interface WaveformDisplayProps {
  audioUrl: string | null
  onSeek?: (time: number) => void
}

export function WaveformDisplay({ audioUrl, onSeek }: WaveformDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const duration = usePlaybackStore((s) => s.duration)

  useEffect(() => {
    // Always tear down any previous instance when the source changes.
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy()
      wavesurferRef.current = null
    }

    if (!containerRef.current || !audioUrl) return

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#383838',
      progressColor: '#facc15',
      cursorColor: '#facc15',
      cursorWidth: 2,
      height: 80,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      interact: true,
      backend: 'WebAudio',
    })

    ws.load(audioUrl)

    ws.on('click', (relativeX: number) => {
      const seekTime = relativeX * (ws.getDuration() || 0)
      onSeek?.(seekTime)
    })

    wavesurferRef.current = ws

    return () => {
      ws.destroy()
      wavesurferRef.current = null
    }
  }, [audioUrl, onSeek])

  useEffect(() => {
    const ws = wavesurferRef.current
    if (!ws || duration === 0) return
    const progress = currentTime / duration
    ws.seekTo(Math.min(progress, 1))
  }, [currentTime, duration])

  return (
    <div className="relative w-full" data-testid="waveform-display">
      <div
        ref={containerRef}
        className="w-full bg-charcoal-900 rounded-lg overflow-hidden"
      />

      {!audioUrl && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-smoke-400"
          aria-live="polite"
        >
          <div className="h-4 w-4 rounded-full border-2 border-charcoal-600 border-t-flame-400 animate-spin" />
          <span>Loading audio…</span>
        </div>
      )}
    </div>
  )
}
