import { NavLink, useLocation } from 'react-router-dom'
import { Music, Heart, Settings, BarChart3, Mic, Timer } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ROUTES } from '@/router/routes'
import { useIsAdmin } from '@/features/analytics/hooks/use-is-admin'
import { useSongViewStore } from '@/stores/song-view.store'

export function BottomNav() {
  const canUseAnalytics = useIsAdmin()
  const inSetlist = useLocation().pathname.startsWith('/setlists/')
  // A song playing on a phone takes the whole screen; the nav comes back on pause.
  const immersive = useSongViewStore((s) => s.immersive)
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
      className={cn(
        'fixed bottom-[var(--vv-bottom-offset)] left-0 right-0 z-40 border-t border-white/10 bg-stage-950/88 pb-[env(safe-area-inset-bottom)] shadow-[0_-18px_60px_rgba(0,0,0,0.42)] backdrop-blur-2xl transition-transform duration-300 ease-out motion-reduce:transition-none lg:hidden',
        // Past its own height, so the active tab's glow above it goes too.
        immersive && 'translate-y-[calc(100%+1rem)]',
      )}
      inert={immersive}
      data-testid="bottom-nav"
    >
      <div className="grid h-16 grid-flow-col auto-cols-fr items-center px-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive: routeActive }) => {
              const isActive = routeActive || (to === ROUTES.SONGS && inSetlist)
              return cn(
                'relative mx-auto flex min-w-0 flex-col items-center gap-1 rounded-2xl px-1.5 py-1.5 text-[0.68rem] font-medium transition-colors',
                isActive
                  ? 'text-fire-300 before:absolute before:-top-[0.55rem] before:left-1/2 before:h-0.5 before:w-7 before:-translate-x-1/2 before:rounded-full before:bg-fire-500 before:shadow-[0_0_12px_rgba(249,115,22,0.9)] [&>svg]:drop-shadow-[0_0_8px_rgba(249,115,22,0.6)]'
                  : 'text-smoke-500 hover:bg-white/5 hover:text-smoke-300',
              )
            }}
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
