import { useState } from 'react'
import { Share2, Download } from 'lucide-react'
import { toast } from 'sonner'
import { downloadBlob } from '../lib/download-blob'
import { shareRecording } from '../lib/share-recording'
import { cn } from '@/lib/cn'

interface ShareMenuProps {
  blob: Blob
  filename: string
}

/**
 * Share button that uses the native Web Share API (with file attachment)
 * when available. Falls back to a simple download on desktop browsers.
 */
export function ShareMenu({ blob, filename }: ShareMenuProps) {
  const [sharing, setSharing] = useState(false)

  const handleShareClick = () => {
    // Call shareRecording synchronously from the click handler
    // to preserve user activation for navigator.share()
    setSharing(true)
    shareRecording(blob, filename).then((status) => {
      setSharing(false)
      if (status === 'shared') {
        toast.success('Recording shared!')
      } else if (status === 'unsupported') {
        downloadBlob(blob, filename)
        toast.info('Sharing not supported — downloading instead.')
      }
    })
  }

  return (
    <button
      onClick={handleShareClick}
      disabled={sharing}
      className={cn(
        'inline-flex items-center justify-center rounded-lg w-16 h-16',
        'bg-charcoal-700 border border-charcoal-600 text-flame-400/70',
        'hover:border-flame-400/30 hover:text-flame-400 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
        sharing && 'opacity-50 cursor-wait',
      )}
      aria-label="Share recording"
      data-testid="recording-share-button"
    >
      {sharing ? (
        <Download size={22} className="animate-pulse" />
      ) : (
        <Share2 size={22} />
      )}
    </button>
  )
}
