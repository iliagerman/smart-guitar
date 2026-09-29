import { NavLink, useLocation } from 'react-router-dom'
import { Music, Heart, Settings, BarChart3, Mic, Timer, type LucideIcon } from 'lucide-react'
import { ROUTES, songDetailPath } from '@/router/routes'
import { cn } from '@/lib/cn'
import { displaySongTitle } from '@/lib/format-song'
import { useIsAdmin } from '@/features/analytics/hooks/use-is-admin'
import { usePracticeSummary } from '@/features/practice/hooks/use-practice-summary'
import { FlameLogo } from '@/components/shared/FlameLogo'

/** How the icon moves when you point at it (see .nav-anim-* in index.css). */
type NavMotion = 'bounce' | 'beat' | 'pulse' | 'swing' | 'rise' | 'spin'

interface NavItem {
    to: string
    icon: LucideIcon
    label: string
    testId: string
    motion: NavMotion
}

/** One destination: an icon tile that lights up in fire when you're there, its name below. */
function RailLink({ item, forceActive = false }: { item: NavItem; forceActive?: boolean }) {
    const { to, icon: Icon, label, testId, motion } = item
    return (
        <NavLink
            to={to}
            className="group flex w-full flex-col items-center gap-1 rounded-2xl py-1 focus-visible:outline-none"
            data-testid={testId}
            title={label}
        >
            {({ isActive: routeActive }) => {
                const isActive = routeActive || forceActive
                return (
                    <>
                        <span
                            className={cn(
                                'grid size-11 place-items-center rounded-2xl transition-[background-color,box-shadow,color,transform] group-focus-visible:ring-2 group-focus-visible:ring-fire-400/70',
                                isActive
                                    ? 'bg-gradient-to-br from-fire-400 to-fire-600 text-white shadow-[0_8px_22px_rgba(249,115,22,0.45),inset_0_1px_0_rgba(255,255,255,0.3)]'
                                    : 'text-smoke-400 group-hover:-translate-y-0.5 group-hover:bg-white/[0.07] group-hover:text-smoke-100'
                            )}
                        >
                            <Icon size={20} strokeWidth={2.1} className={`nav-anim-${motion}`} aria-hidden="true" />
                        </span>
                        <span
                            className={cn(
                                'max-w-full truncate text-[10.5px] font-semibold transition-colors',
                                isActive ? 'text-smoke-100' : 'text-smoke-500 group-hover:text-smoke-300'
                            )}
                        >
                            {label}
                        </span>
                    </>
                )
            }}
        </NavLink>
    )
}

/** The streak as a small flame; it leads to the song waiting on the music stand. */
function StreakBadge() {
    const { data } = usePracticeSummary()
    if (!data) return null
    const next = data.continue_songs[0]
    const streak = data.streak_days
    const hint = [
        streak > 0 ? `${streak}-day streak` : 'Start a streak',
        data.practiced_today ? 'you played today' : 'play one song today to keep it lit',
        next ? `next up: ${displaySongTitle(next.song)}` : null,
    ].filter(Boolean).join(' · ')
    return (
        <NavLink
            to={next ? songDetailPath(next.song.id) : ROUTES.SONGS}
            className="group flex flex-col items-center gap-1.5 rounded-2xl px-1 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire-400/70"
            title={hint}
            aria-label={hint}
            data-testid="sidebar-practice-nudge"
        >
            <span className="relative grid size-11 place-items-center text-[1.7rem] leading-none transition-transform group-hover:scale-110" aria-hidden="true">
                <span
                    className={cn(
                        'animate-flame-flicker',
                        data.practiced_today ? 'drop-shadow-[0_0_10px_rgba(249,115,22,0.75)]' : 'opacity-70 grayscale-[0.6]'
                    )}
                >
                    🔥
                </span>
                <span className="absolute -right-0.5 top-0 grid min-w-5 place-items-center rounded-full bg-stage-950 px-1 font-mono text-[10px] font-bold text-fire-300 ring-1 ring-fire-500/50">
                    {streak}
                </span>
            </span>
            <span className="text-[10px] font-semibold text-smoke-500 group-hover:text-smoke-300">Streak</span>
        </NavLink>
    )
}

/**
 * Desktop navigation: a slim rail floating over the stage, so every page keeps
 * the room (and the lights) for itself.
 */
export function SidebarNav() {
    const canUseAnalytics = useIsAdmin()
    // Setlists are part of the song library, so Songs stays lit on them.
    const inSetlist = useLocation().pathname.startsWith('/setlists/')
    const items: NavItem[] = [
        { to: ROUTES.SONGS, icon: Music, label: 'Songs', testId: 'sidebar-songs', motion: 'bounce' },
        { to: ROUTES.FAVORITES, icon: Heart, label: 'Favorites', testId: 'sidebar-favorites', motion: 'beat' },
        { to: ROUTES.TUNER, icon: Mic, label: 'Tuner', testId: 'sidebar-tuner', motion: 'pulse' },
        { to: ROUTES.METRONOME, icon: Timer, label: 'Metronome', testId: 'sidebar-metronome', motion: 'swing' },
        ...(canUseAnalytics ? [{ to: ROUTES.ANALYTICS, icon: BarChart3, label: 'Analytics', testId: 'sidebar-analytics', motion: 'rise' as const }] : []),
    ]

    return (
        <aside
            className="hidden lg:relative lg:z-40 lg:flex lg:w-[var(--nav-rail-width)] lg:shrink-0 lg:py-3 lg:pl-3"
            data-testid="sidebar-nav"
        >
            <div className="relative flex w-full flex-col items-center overflow-hidden rounded-[1.75rem] border border-white/[0.07] bg-[linear-gradient(180deg,rgba(17,14,21,0.92)_0%,rgba(10,8,13,0.94)_100%)] px-2 pb-3 pt-3 shadow-[0_24px_60px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)]">
                <NavLink
                    to={ROUTES.SONGS}
                    className="group mb-4 grid place-items-center rounded-2xl transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire-400/70"
                    aria-label="Smart Guitar home"
                    title="Smart Guitar"
                >
                    <FlameLogo className="size-14 animate-logo-breathe" />
                </NavLink>

                <nav className="flex w-full flex-1 flex-col items-center gap-2" aria-label="Primary">
                    {items.map((item) => (
                        <RailLink key={item.to} item={item} forceActive={item.to === ROUTES.SONGS && inSetlist} />
                    ))}
                </nav>

                <div className="flex w-full flex-col items-center gap-2 border-t border-white/[0.06] pt-3">
                    <StreakBadge />
                    <RailLink item={{ to: ROUTES.PROFILE, icon: Settings, label: 'Settings', testId: 'sidebar-profile', motion: 'spin' }} />
                </div>
            </div>
        </aside>
    )
}
