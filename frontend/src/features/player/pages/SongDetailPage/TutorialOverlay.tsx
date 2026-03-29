import { useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

interface TutorialLink {
  url: string
  title: string
}

interface TutorialOverlayProps {
  tutorialUrl: string | null | undefined
  tutorialLinks: TutorialLink[] | null | undefined
  onClose: () => void
}

interface EmbedItem {
  embedUrl: string
  title: string
}

function buildEmbedItems(
  tutorialUrl: string | null | undefined,
  tutorialLinks: TutorialLink[] | null | undefined,
): EmbedItem[] {
  const allLinks = tutorialLinks?.length
    ? tutorialLinks
    : tutorialUrl
      ? [{ url: tutorialUrl, title: '' }]
      : []

  return allLinks
    .map((link) => {
      const match = link.url.match(/(?:youtube\.com\/.*[?&]v=|youtu\.be\/)([\w-]+)/)
      return match ? { embedUrl: `https://www.youtube.com/embed/${match[1]}`, title: link.title } : null
    })
    .filter((x): x is EmbedItem => x !== null)
}

/**
 * Floating YouTube tutorial player that appears at the bottom of the screen.
 * Supports navigating through multiple tutorial videos.
 */
export function TutorialOverlay({ tutorialUrl, tutorialLinks, onClose }: TutorialOverlayProps) {
  const [tutorialIndex, setTutorialIndex] = useState(0)
  const embedItems = buildEmbedItems(tutorialUrl, tutorialLinks)

  if (embedItems.length === 0) return null

  const safeIndex = Math.min(tutorialIndex, embedItems.length - 1)
  const current = embedItems[safeIndex]

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-60 max-w-100 ml-auto rounded-lg overflow-hidden shadow-2xl border border-charcoal-600 bg-charcoal-900"
      data-testid="tutorial-overlay"
    >
      <div className="flex items-center justify-between px-3 py-2 bg-charcoal-800">
        <span className="text-xs text-smoke-300 font-medium truncate flex-1 mr-2">
          {current.title || 'Tutorial'}
        </span>
        <div className="flex items-center gap-0.5 sm:gap-1">
          {embedItems.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setTutorialIndex((i) => Math.max(0, i - 1))}
                disabled={safeIndex === 0}
                className="text-smoke-500 hover:text-smoke-200 disabled:opacity-30 transition-colors p-2 sm:p-0.5"
                aria-label="Previous tutorial"
                data-testid="tutorial-prev-button"
              >
                <ChevronLeft size={18} className="sm:size-3.5" />
              </button>
              <span className="text-xs sm:text-[10px] text-smoke-500 tabular-nums">
                {safeIndex + 1}/{embedItems.length}
              </span>
              <button
                type="button"
                onClick={() => setTutorialIndex((i) => Math.min(embedItems.length - 1, i + 1))}
                disabled={safeIndex === embedItems.length - 1}
                className="text-smoke-500 hover:text-smoke-200 disabled:opacity-30 transition-colors p-2 sm:p-0.5"
                aria-label="Next tutorial"
                data-testid="tutorial-next-button"
              >
                <ChevronRight size={18} className="sm:size-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-smoke-500 hover:text-smoke-200 transition-colors ml-1 p-2 sm:p-0"
            aria-label="Close tutorial"
            data-testid="tutorial-close-button"
          >
            <X size={18} className="sm:size-3.5" />
          </button>
        </div>
      </div>
      <iframe
        src={current.embedUrl}
        className="w-full aspect-video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title={current.title || 'Guitar tutorial'}
      />
    </div>
  )
}
