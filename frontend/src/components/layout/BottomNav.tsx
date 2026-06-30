import { NavLink } from 'react-router-dom'
import { Music, Heart, Settings, BarChart3, Mic, Timer } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ROUTES } from '@/router/routes'
import { useIsAdmin } from '@/features/analytics/hooks/use-is-admin'

export function BottomNav() {
  const canUseAnalytics = useIsAdmin()
  const navItems = [
    { to: ROUTES.SONGS, icon: Music, label: 'Songs' },
    { to: ROUTES.FAVORITES, icon: Heart, label: 'Favorites' },
    { to: ROUTES.TUNER, icon: Mic, label: 'Tuner' },
    { to: ROUTES.METRONOME, icon: Timer, label: 'Metronome' },
    ...(canUseAnalytics ? [{ to: ROUTES.ANALYTICS, icon: BarChart3, label: 'Analytics' }] : []),
    { to: ROUTES.PROFILE, icon: Settings, label: 'Settings' },
  ]

  return (
    <nav
      className="fixed bottom-[var(--vv-bottom-offset)] left-0 right-0 z-40 border-t border-white/10 bg-charcoal-950/88 pb-[env(safe-area-inset-bottom)] shadow-[0_-18px_60px_rgba(0,0,0,0.42)] backdrop-blur-2xl lg:hidden"
      data-testid="bottom-nav"
    >
      <div className="grid h-16 grid-flow-col auto-cols-fr items-center px-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'mx-auto flex min-w-0 flex-col items-center gap-1 rounded-2xl px-1.5 py-1.5 text-[0.68rem] font-medium transition-colors',
                isActive
                  ? 'bg-flame-400/12 text-flame-300'
                  : 'text-smoke-500 hover:bg-white/5 hover:text-smoke-300',
              )
            }
            data-testid={`nav-${label.toLowerCase()}`}
          >
            <Icon size={21} aria-hidden="true" />
            <span className="max-w-full truncate leading-none">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
