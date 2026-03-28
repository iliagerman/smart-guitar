import { useState, useEffect, useCallback, useLayoutEffect } from 'react'
import { Heart, Music, Type, LayoutGrid, Circle } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

import { cn } from '@/lib/cn'
import { useSubscriptionStore } from '@/stores/subscription.store'
import { subscriptionApi } from '@/api/subscription.api'
import { queryKeys } from '@/api/query-keys'

interface TourStep {
  tourAttr: string
  title: string
  description: string
  icon: React.ReactNode
}

const STEPS: TourStep[] = [
  {
    tourAttr: 'favorite',
    title: 'Add to Favorites',
    description: 'Tap the heart to save songs you love for quick access later.',
    icon: <Heart size={20} />,
  },
  {
    tourAttr: 'record',
    title: 'Record Yourself',
    description: 'Record your practice session and download it when you\'re done. You can also enable video recording in Settings.',
    icon: <Circle size={20} />,
  },
  {
    tourAttr: 'stem-selector',
    title: 'Change the Stem',
    description: 'Switch between vocals, guitar, guitar + vocals, or the full mix to practice along.',
    icon: <Music size={20} />,
  },
  {
    tourAttr: 'lyrics-toggle',
    title: 'Switch Lyrics Version',
    description: 'Tap to switch between lyrics versions: V1 (fast, basic), V2 (timed with word highlighting), V3 (corrected & most accurate), or turn lyrics off entirely.',
    icon: <Type size={20} />,
  },
  {
    tourAttr: 'chord-map',
    title: 'Strumming & Chord Map',
    description: 'View chord shapes and strumming patterns for the song.',
    icon: <LayoutGrid size={20} />,
  },
]

const PADDING = 6

function getTargetRect(tourAttr: string): DOMRect | null {
  // For wrapper divs with contents class, find the child button
  const wrapper = document.querySelector(`[data-tour="${tourAttr}"]`)
  if (!wrapper) return null
  const target = wrapper.tagName === 'BUTTON' ? wrapper : wrapper.querySelector('button') ?? wrapper
  return target.getBoundingClientRect()
}

export function OnboardingTour() {
  const queryClient = useQueryClient()
  const hasSeenOnboarding = useSubscriptionStore((s) => s.status?.has_seen_onboarding ?? true)
  const isLoaded = useSubscriptionStore((s) => s.isLoaded)
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [active, setActive] = useState(false)

  // Wait for subscription data to load and target elements to exist before starting
  useEffect(() => {
    if (!isLoaded || hasSeenOnboarding) return
    const check = () => {
      const allExist = STEPS.every((s) => document.querySelector(`[data-tour="${s.tourAttr}"]`))
      if (allExist) {
        setActive(true)
      }
    }
    // Delay to let the page render
    const timer = setTimeout(check, 800)
    return () => clearTimeout(timer)
  }, [isLoaded, hasSeenOnboarding])

  // Measure the current step's target element
  useLayoutEffect(() => {
    if (!active) return
    const step = STEPS[stepIndex]
    if (!step) return
    const measure = () => setRect(getTargetRect(step.tourAttr))
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [active, stepIndex])

  const dismiss = useCallback(async () => {
    setActive(false)
    // Optimistically update the local store
    const store = useSubscriptionStore.getState()
    if (store.status) {
      store.setStatus({ ...store.status, has_seen_onboarding: true })
    }
    // Persist to server, then invalidate the query cache so refetches
    // return the updated value instead of overwriting the optimistic update
    try {
      await subscriptionApi.markOnboardingSeen()
      await queryClient.invalidateQueries({ queryKey: queryKeys.subscription.status() })
    } catch {
      // If the API call fails, the optimistic update stays — tour won't reappear
      // until the next full page load
    }
  }, [queryClient])

  const handleNext = useCallback(() => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex((i) => i + 1)
    } else {
      dismiss()
    }
  }, [stepIndex, dismiss])

  const handleBack = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1))
  }, [])

  // Escape key dismisses
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, dismiss])

  if (!active || !rect) return null

  const step = STEPS[stepIndex]
  const isLast = stepIndex === STEPS.length - 1

  // Position tooltip below the highlighted element
  const tooltipTop = rect.bottom + PADDING + 12
  const tooltipLeft = Math.max(16, Math.min(rect.left + rect.width / 2 - 140, window.innerWidth - 296))

  return (
    <div className="fixed inset-0 z-60" aria-modal="true" role="dialog">
      {/* Overlay backdrop — clicking it dismisses */}
      <div className="absolute inset-0" onClick={dismiss} />

      {/* Spotlight cutout */}
      <div
        className="absolute rounded-xl ring-2 ring-flame-400 animate-pulse pointer-events-none"
        style={{
          top: rect.top - PADDING,
          left: rect.left - PADDING,
          width: rect.width + PADDING * 2,
          height: rect.height + PADDING * 2,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.65)',
        }}
      />

      {/* Tooltip card */}
      <div
        className={cn(
          'absolute w-70 rounded-xl',
          'bg-charcoal-800 border border-charcoal-600 shadow-2xl',
          'p-4 text-left',
        )}
        style={{
          top: tooltipTop,
          left: tooltipLeft,
        }}
      >
        {/* Arrow pointing up */}
        <div
          className="absolute -top-2 w-4 h-4 rotate-45 bg-charcoal-800 border-l border-t border-charcoal-600"
          style={{ left: Math.max(20, rect.left + rect.width / 2 - tooltipLeft - 8) }}
        />

        <div className="flex items-center gap-2 mb-2">
          <span className="text-flame-400">{step.icon}</span>
          <h3 className="text-sm font-semibold text-smoke-100">{step.title}</h3>
          <span className="ml-auto text-xs text-smoke-500">{stepIndex + 1}/{STEPS.length}</span>
        </div>

        <p className="text-xs text-smoke-400 leading-relaxed mb-4">{step.description}</p>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={dismiss}
            className="text-xs text-smoke-500 hover:text-smoke-300 transition-colors"
          >
            Skip
          </button>

          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={handleBack}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-charcoal-600 text-smoke-300 hover:bg-charcoal-700 transition-colors"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={handleNext}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-flame-400 text-charcoal-900 hover:bg-flame-300 transition-colors"
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
