import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Download, Pause, Play, Share2, X } from 'lucide-react'
import { toast } from 'sonner'
import { shareRecording } from '../lib/share-recording'
import { downloadBlob } from '../lib/download-blob'
import { cn } from '@/lib/cn'

interface ShareDialogProps {
  blob: Blob
  filename: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Listen back to an audio take: a fire play button and bars that dance while it plays. */
function AudioPreview({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play()
    else audio.pause()
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-2.5" data-testid="share-dialog-preview">
      <audio ref={audioRef} src={src} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      <button
        type="button"
        onClick={toggle}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fire-400 to-fire-600 text-white shadow-[0_8px_22px_rgba(249,115,22,0.45)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        aria-label={playing ? 'Pause your take' : 'Listen to your take'}
        data-testid="share-dialog-listen-button"
      >
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} className="ml-0.5" fill="currentColor" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-smoke-100">Listen back</p>
        <p className="text-xs text-smoke-400">Hear how you sounded</p>
      </div>
      <div className="flex h-7 items-end gap-[3px] pr-1" aria-hidden="true">
        {[0.5, 0.9, 0.65, 1, 0.75].map((height, i) => (
          <span
            // Decorative bars, fixed and positional.
            // oxlint-disable-next-line react-doctor/no-array-index-key
            key={i}
            className={cn('w-1 origin-bottom rounded-full bg-fire-400/80', playing && 'animate-[nav-rise_0.7s_ease-in-out_infinite]')}
            style={{ height: `${height * 100}%`, animationDelay: `${i * 0.12}s` }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Shown when a recording finishes: listen back to the take, then share it
 * (native share sheet, saving the file too) or just download it.
 */
export function ShareDialog({ blob, filename, open, onOpenChange }: ShareDialogProps) {
  const shareRef = useRef<HTMLButtonElement>(null)
  const src = useMemo(() => URL.createObjectURL(blob), [blob])
  useEffect(() => () => URL.revokeObjectURL(src), [src])
  const isVideo = blob.type.startsWith('video/')

  const handleShare = () => {
    downloadBlob(blob, filename)
    shareRecording(blob, filename).then((status) => {
      if (status === 'shared') {
        toast.success('Recording shared!')
        onOpenChange(false)
      } else if (status === 'unsupported') {
        toast.info('Sharing not supported — file saved locally.')
        onOpenChange(false)
      }
      // 'cancelled' — keep dialog open, file is already saved
    })
  }

  const handleDownload = () => {
    downloadBlob(blob, filename)
    toast.success('Recording saved')
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            shareRef.current?.focus({ preventScroll: true })
          }}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2',
            'overflow-hidden rounded-[1.75rem] border border-fire-500/25 bg-stage-950/95 p-5',
            'shadow-[0_30px_80px_rgba(0,0,0,0.7),0_0_60px_rgba(249,115,22,0.18)] backdrop-blur-2xl',
            'animate-in fade-in-0 zoom-in-95',
          )}
          data-testid="share-dialog"
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_top,rgba(249,115,22,0.28),transparent_70%)]"
            aria-hidden="true"
          />

          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.26em] text-fire-300">Your take</p>
              <Dialog.Title className="mt-1.5 text-2xl font-extrabold text-smoke-50">Nice playing! 🔥</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-smoke-400">Listen back, then share it or keep it.</Dialog.Description>
            </div>
            <Dialog.Close
              className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-smoke-300 transition-colors hover:border-white/20 hover:text-smoke-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
              aria-label="Close share dialog"
              data-testid="share-dialog-close"
            >
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="relative mt-4">
            {isVideo ? (
              <video
                src={src}
                controls
                playsInline
                className="aspect-video w-full rounded-2xl bg-black ring-1 ring-white/10"
                data-testid="share-dialog-preview"
              />
            ) : (
              <AudioPreview src={src} />
            )}
          </div>

          <div className="relative mt-4 grid gap-2">
            <button
              ref={shareRef}
              type="button"
              onClick={handleShare}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-br from-fire-400 to-fire-600 text-sm font-extrabold text-white shadow-[0_12px_30px_rgba(249,115,22,0.42)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              data-testid="share-dialog-share-button"
            >
              <Share2 size={18} aria-hidden="true" />
              Share your take
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.05] text-sm font-bold text-smoke-200 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-smoke-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
              data-testid="share-dialog-download-button"
            >
              <Download size={18} aria-hidden="true" />
              Download
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
