import * as Dialog from '@radix-ui/react-dialog'
import { Download, Share2, X } from 'lucide-react'
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

/**
 * Modal dialog that appears after recording finishes, offering share and download actions.
 * Uses the native Web Share API for sharing; falls back to download when unsupported.
 */
export function ShareDialog({ blob, filename, open, onOpenChange }: ShareDialogProps) {
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
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'w-[calc(100%-2rem)] max-w-sm',
            'rounded-2xl bg-charcoal-900 border border-charcoal-700 shadow-2xl',
            'flex flex-col overflow-hidden',
          )}
          data-testid="share-dialog"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-charcoal-800">
            <Dialog.Title className="text-sm font-semibold text-smoke-100">
              Recording ready
            </Dialog.Title>
            <Dialog.Close
              className="text-smoke-500 hover:text-smoke-200 transition-colors"
              aria-label="Close share dialog"
              data-testid="share-dialog-close"
            >
              <X size={18} />
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-2 p-4">
            <button
              onClick={handleShare}
              className={cn(
                'flex items-center gap-3 w-full rounded-lg px-4 py-3',
                'bg-flame-500/20 border border-flame-500/40 text-flame-300',
                'hover:bg-flame-500/30 hover:text-flame-200 transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-flame-400/40',
              )}
              data-testid="share-dialog-share-button"
            >
              <Share2 size={20} />
              <span className="text-sm font-medium">Share</span>
            </button>

            <button
              onClick={handleDownload}
              className={cn(
                'flex items-center gap-3 w-full rounded-lg px-4 py-3',
                'bg-charcoal-700 border border-charcoal-600 text-smoke-300',
                'hover:border-charcoal-500 hover:text-smoke-100 transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-flame-400/40',
              )}
              data-testid="share-dialog-download-button"
            >
              <Download size={20} />
              <span className="text-sm font-medium">Download</span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
