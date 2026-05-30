import * as Dialog from '@radix-ui/react-dialog'
import { Download, X } from 'lucide-react'
import type { SearchResult } from '@/types/song'
import { formatDuration } from '@/lib/format-duration'
import { slugToTitleCase } from '@/lib/format-song'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { cn } from '@/lib/cn'

interface SearchPreviewDialogProps {
  /** The web result to preview, or `null` when the dialog is closed. */
  result: SearchResult | null
  /** Called when the dialog should close (cancel, Esc, overlay, close button). */
  onClose: () => void
  /** Called when the user confirms — kicks off the existing download/process flow. */
  onConfirm: (result: SearchResult) => void
  /** True while the confirmed download is in flight. */
  isDownloading?: boolean
  /** Rotating "Fetching the music…" label shown while downloading. */
  downloadLabel?: string
}

/**
 * Lets the user watch the YouTube video for a web search result before
 * committing to the heavy download + processing pipeline, so they can confirm
 * it's the right song first.
 *
 * @example
 * <SearchPreviewDialog
 *   result={previewResult}
 *   onClose={() => setPreviewResult(null)}
 *   onConfirm={handleConfirmDownload}
 * />
 */
export function SearchPreviewDialog({
  result,
  onClose,
  onConfirm,
  isDownloading,
  downloadLabel,
}: SearchPreviewDialogProps) {
  const open = result !== null

  const handleOpenChange = (next: boolean) => {
    // Never close mid-download — the request is already in flight and will
    // navigate away on success.
    if (!next && !isDownloading) onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'w-[calc(100%-2rem)] max-w-lg',
            'rounded-2xl bg-charcoal-900 border border-charcoal-700 shadow-2xl',
            'flex flex-col overflow-hidden',
          )}
          data-testid="search-preview-dialog"
        >
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-charcoal-800">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold text-smoke-100 truncate">
                {result ? slugToTitleCase(result.song) || result.title : ''}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-smoke-400 truncate">
                {result ? slugToTitleCase(result.artist) || result.artist : ''}
                {result?.duration_seconds ? ` · ${formatDuration(result.duration_seconds)}` : ''}
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="shrink-0 text-smoke-500 hover:text-smoke-200 transition-colors disabled:opacity-30"
              aria-label="Close preview"
              disabled={isDownloading}
              data-testid="search-preview-close"
            >
              <X size={18} />
            </Dialog.Close>
          </div>

          {result && (
            <div className="bg-black">
              {/* YouTube embeds require both allow-scripts and allow-same-origin to play, which
                  react-doctor flags as an escapable sandbox; the src is built from a YouTube video
                  id (not arbitrary user input), so the residual risk is acceptable and the sandbox
                  still blocks forms, top-navigation, etc. */}
              {/* oxlint-disable-next-line react-doctor/iframe-missing-sandbox */}
              <iframe sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                src={`https://www.youtube.com/embed/${result.youtube_id}?autoplay=1&rel=0`}
                className="w-full aspect-video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title={result.title || 'Song preview'}
                data-testid="search-preview-player"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 p-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isDownloading}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium',
                'bg-charcoal-700 border border-charcoal-600 text-smoke-300',
                'hover:border-charcoal-500 hover:text-smoke-100 transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-flame-400/40',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
              data-testid="search-preview-cancel-button"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => result && onConfirm(result)}
              disabled={isDownloading}
              className={cn(
                'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium',
                'bg-flame-500/20 border border-flame-500/40 text-flame-300',
                'hover:bg-flame-500/30 hover:text-flame-200 transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-flame-400/40',
                'disabled:opacity-60 disabled:cursor-not-allowed',
              )}
              data-testid="search-preview-confirm-button"
            >
              {isDownloading ? (
                <>
                  <LoadingSpinner size="sm" />
                  <span>{downloadLabel ?? 'Fetching the music…'}</span>
                </>
              ) : (
                <>
                  <Download size={16} />
                  <span>Add &amp; Process</span>
                </>
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
