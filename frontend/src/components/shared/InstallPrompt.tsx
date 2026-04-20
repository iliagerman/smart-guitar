import { useEffect, useMemo, useState } from 'react'
import { X, Download, Share } from 'lucide-react'

import { isAppleMobileSafariLike } from '@/lib/device'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'pwa-install-dismissed'
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function wasDismissedRecently(): boolean {
  const dismissed = localStorage.getItem(DISMISSED_KEY)
  if (!dismissed) return false
  return Date.now() - Number(dismissed) < DISMISS_DURATION_MS
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isIosNonSafari(): boolean {
  return isIos() && !isAppleMobileSafariLike()
}

function isInStandaloneMode(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  )
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosInstructions, setShowIosInstructions] = useState(false)
  const showIosBanner = useMemo(() => {
    if (isInStandaloneMode() || wasDismissedRecently()) return false
    return isIos()
  }, [])
  const showIosSafariInstructions = useMemo(() => showIosBanner && isAppleMobileSafariLike(), [showIosBanner])
  const showIosSafariFallback = useMemo(() => showIosBanner && isIosNonSafari(), [showIosBanner])
  const [visible, setVisible] = useState(() => {
    if (isInStandaloneMode() || wasDismissedRecently()) return false
    return isIos()
  })

  useEffect(() => {
    if (isInStandaloneMode() || wasDismissedRecently()) return

    // Android / Chrome: capture the beforeinstallprompt event
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', handler)

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const dismiss = () => {
    setVisible(false)
    setShowIosInstructions(false)
    localStorage.setItem(DISMISSED_KEY, String(Date.now()))
  }

  const install = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setVisible(false)
    }
    setDeferredPrompt(null)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md animate-slide-up">
      <div className="flex items-start gap-3 rounded-2xl border border-charcoal-700 bg-charcoal-900/95 p-4 shadow-lg backdrop-blur-sm">
        <img
          src="/icons/icon-192x192.png"
          alt="Smart Guitar"
          className="h-12 w-12 shrink-0 rounded-xl"
        />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-smoke-100">Install Smart Guitar</p>

          {showIosBanner ? (
            <>
              {showIosSafariInstructions ? (
                <>
                  <p className="mt-0.5 text-xs text-smoke-400">
                    Install this app from Safari to keep it on your home screen.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowIosInstructions((prev) => !prev)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-fire-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-fire-500 active:bg-fire-700"
                    data-testid="install-prompt-ios-instructions-button"
                  >
                    <Share className="h-3.5 w-3.5" />
                    {showIosInstructions ? 'Hide steps' : 'How to install'}
                  </button>
                  {showIosInstructions && (
                    <div
                      className="mt-2 rounded-xl border border-charcoal-700 bg-charcoal-800/80 px-3 py-2 text-xs text-smoke-300"
                      data-testid="install-prompt-ios-instructions"
                    >
                      <ol className="list-decimal space-y-1 pl-4">
                        <li>Tap <Share className="inline h-3.5 w-3.5 align-text-bottom text-fire-400" /> in Safari.</li>
                        <li>Choose <span className="font-medium text-smoke-100">Add to Home Screen</span>.</li>
                        <li>Tap <span className="font-medium text-smoke-100">Add</span> to finish.</li>
                      </ol>
                    </div>
                  )}
                </>
              ) : showIosSafariFallback ? (
                <div className="mt-0.5 text-xs text-smoke-400" data-testid="install-prompt-ios-open-safari">
                  Open this page in Safari, then use <span className="font-medium text-smoke-300">Share → Add to Home Screen</span>.
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-0.5 text-xs text-smoke-400">
                Add to your home screen for quick access
              </p>
              <button
                type="button"
                onClick={install}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-fire-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-fire-500 active:bg-fire-700"
                data-testid="install-prompt-install-button"
              >
                <Download className="h-3.5 w-3.5" />
                Install
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-lg p-1 text-smoke-500 transition-colors hover:bg-charcoal-700 hover:text-smoke-300"
          aria-label="Dismiss install prompt"
          data-testid="install-prompt-dismiss-button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
