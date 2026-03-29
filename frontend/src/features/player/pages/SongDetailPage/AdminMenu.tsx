import { useState, useEffect, useRef } from 'react'
import { Shield } from 'lucide-react'
import { toast } from 'sonner'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { songsApi } from '@/api/songs.api'
import { subscriptionApi } from '@/api/subscription.api'
import { cn } from '@/lib/cn'

interface AdminMenuProps {
  songId: string
}

interface RegenerateItem {
  label: string
  targets: string[]
}

const REGENERATE_ITEMS: RegenerateItem[] = [
  { label: 'Regenerate Lyrics', targets: ['lyrics'] },
  { label: 'Regenerate Stems & Chords', targets: ['stems'] },
  { label: 'Regenerate Tabs', targets: ['tabs'] },
  { label: 'Regenerate Strum Patterns', targets: ['strums'] },
  { label: 'Regenerate All', targets: ['lyrics', 'stems', 'tabs', 'strums'] },
  { label: 'Full Reprocess', targets: ['full'] },
]

/**
 * Admin-only dropdown menu for regenerating song data and resetting onboarding.
 */
export function AdminMenu({ songId }: AdminMenuProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleRegenerate = async (targets: string[], label: string) => {
    setLoading(label)
    setOpen(false)
    try {
      const result = await songsApi.regenerate(songId, targets)
      if (result.enqueued.length > 0) {
        toast.success(`Regenerating: ${result.enqueued.join(', ')}`)
      } else if (result.errors.length > 0) {
        toast.error(`Failed: ${result.errors.join(', ')}`)
      } else {
        toast.info(`Skipped (already up to date): ${result.skipped.join(', ')}`)
      }
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(detail ?? 'Regeneration failed')
    } finally {
      setLoading(null)
    }
  }

  const handleResetOnboarding = async () => {
    setLoading('Reset Onboarding')
    setOpen(false)
    try {
      await subscriptionApi.resetOnboarding()
      toast.success('Onboarding reset — reload the page to see it')
    } catch {
      toast.error('Failed to reset onboarding')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'p-2 rounded-lg text-smoke-400 hover:text-flame-400 hover:bg-charcoal-700/50 transition-colors',
          open && 'text-flame-400 bg-charcoal-700/50',
        )}
        aria-label="Admin actions"
        title="Admin actions"
        data-testid="admin-menu-toggle"
      >
        {loading ? (
          <LoadingSpinner size="xs" inline className="h-5 w-5" />
        ) : (
          <Shield size={20} />
        )}
      </button>
      {open && (
        <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1 w-56 rounded-lg bg-charcoal-800 border border-charcoal-600 shadow-xl z-50 py-1">
          {REGENERATE_ITEMS.map((item) => (
            <button
              key={item.label}
              onClick={() => handleRegenerate(item.targets, item.label)}
              disabled={!!loading}
              className="w-full text-left px-3 py-2 text-sm text-smoke-200 hover:bg-charcoal-700 hover:text-flame-400 transition-colors disabled:opacity-50"
              data-testid={`admin-menu-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {item.label}
            </button>
          ))}
          <div className="border-t border-charcoal-600 my-1" />
          <button
            onClick={handleResetOnboarding}
            disabled={!!loading}
            className="w-full text-left px-3 py-2 text-sm text-smoke-200 hover:bg-charcoal-700 hover:text-flame-400 transition-colors disabled:opacity-50"
            data-testid="admin-menu-reset-onboarding"
          >
            Reset Onboarding Tour
          </button>
        </div>
      )}
    </div>
  )
}
