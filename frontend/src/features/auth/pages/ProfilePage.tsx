import { useAuthStore } from '@/stores/auth.store'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '@/router/routes'
import { LogOut, Settings } from 'lucide-react'
import { SubscriptionSection } from '@/features/subscription/components/SubscriptionSection'
import { VersionBadge } from '@/components/shared/VersionBadge'
import { LegalFooter } from '@/components/layout/LegalFooter'
import { PageBackground } from '@/components/shared/PageBackground'
import { PageHeader } from '@/components/shared/PageHeader'
import { usePracticeSummary } from '@/features/practice/hooks/use-practice-summary'
import { SKILL_LEVELS } from '@/features/practice/lib/practice-steps'
import { RecordingSettingsSection } from '../components/RecordingSettingsSection'

export function ProfilePage() {
  const { email, logout } = useAuthStore()
  const navigate = useNavigate()
  const { data: summary } = usePracticeSummary()
  const levelLabel = SKILL_LEVELS.find((l) => l.level === summary?.skill_level)?.label
  const initial = (email || 'U').charAt(0).toUpperCase()

  const handleLogout = () => {
    logout()
    navigate(ROUTES.LOGIN)
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden" data-testid="profile-page">
      <PageBackground />
      <PageHeader title="Settings" eyebrow="Your gear" icon={<Settings size={24} />} />
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom)+var(--vv-bottom-offset))] lg:pb-6">
        <div className="mx-auto max-w-3xl space-y-4 p-4 sm:px-6">
          {/* Player card */}
          <div className="flex items-center gap-4 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-6">
            <div className="grid size-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fire-500 to-ember-600 font-display text-3xl text-white shadow-[0_10px_30px_rgba(249,115,22,0.35)]">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-smoke-100">{email || 'User'}</p>
              <p className="text-sm text-smoke-400">{levelLabel ?? 'Guitar player'}</p>
            </div>
            {summary && (
              <div className="shrink-0 text-right">
                <p className="font-display text-3xl leading-none text-fire-400">{summary.streak_days}</p>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-smoke-500">day streak</p>
              </div>
            )}
          </div>

          <SubscriptionSection />

          <RecordingSettingsSection />

          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-3 text-smoke-300 transition-colors hover:border-red-500 hover:text-red-400"
            data-testid="logout-button"
          >
            <LogOut size={18} />
            Sign out
          </button>

          <VersionBadge />
          <LegalFooter />
        </div>
      </div>
    </div>
  )
}
