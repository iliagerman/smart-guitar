import { NavLink } from 'react-router-dom'
import { Search, Library, Heart, User } from 'lucide-react'
import { ROUTES } from '@/router/routes'
import { cn } from '@/lib/cn'

const navItems = [
    { to: ROUTES.SEARCH, icon: Search, label: 'Search', testId: 'sidebar-search' },
    { to: ROUTES.LIBRARY, icon: Library, label: 'Library', testId: 'sidebar-library' },
    { to: ROUTES.FAVORITES, icon: Heart, label: 'Favorites', testId: 'sidebar-favorites' },
]

export function SidebarNav() {
    return (
        <aside
            className={cn(
                'hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0',
                'border-r border-charcoal-800 bg-black'
            )}
            data-testid="sidebar-nav"
        >
            <div className="h-16 px-4 flex items-center border-b border-charcoal-800">
                <NavLink to={ROUTES.LIBRARY} className="flex items-center gap-3 min-w-0">
                    <img src="/art/logo.png" alt="Smart Guitar" className="w-8 h-8 rounded-full object-cover shrink-0" />
                    <span className="text-2xl font-display tracking-wide text-smoke-100 truncate">
                        SMART GUITAR
                    </span>
                </NavLink>
            </div>

            <nav className="flex-1 p-3" aria-label="Primary">
                <div className="flex flex-col gap-1">
                    {navItems.map(({ to, icon: Icon, label, testId }) => (
                        <NavLink
                            key={to}
                            to={to}
                            className={({ isActive }) =>
                                cn(
                                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-base font-semibold',
                                    'border border-transparent transition-colors',
                                    // Avoid light-blue: keep hover/active in fire palette.
                                    isActive
                                        ? 'bg-flame-400/15 border-flame-400/25 text-smoke-100'
                                        : 'text-smoke-300 hover:bg-flame-400/10 hover:border-flame-400/20 hover:text-smoke-100'
                                )
                            }
                            data-testid={testId}
                        >
                            <Icon size={22} className="text-flame-400/80" />
                            <span className="truncate">{label}</span>
                        </NavLink>
                    ))}
                </div>
            </nav>

            <div className="p-3 border-t border-charcoal-800">
                <NavLink
                    to={ROUTES.PROFILE}
                    className={({ isActive }) =>
                        cn(
                            'flex items-center gap-3 rounded-xl px-3 py-2.5 text-base font-semibold',
                            'border border-transparent transition-colors',
                            isActive
                                ? 'bg-flame-400/15 border-flame-400/25 text-smoke-100'
                                : 'text-smoke-300 hover:bg-flame-400/10 hover:border-flame-400/20 hover:text-smoke-100'
                        )
                    }
                    data-testid="sidebar-profile"
                >
                    <User size={22} className="text-flame-400/80" />
                    <span className="truncate">Profile</span>
                </NavLink>

                <div className="mt-3 px-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-smoke-500">
                    <a href="https://smart-guitar.com/terms.html" target="_blank" rel="noopener noreferrer" className="hover:text-flame-400 transition-colors">Terms</a>
                    <a href="https://smart-guitar.com/privacy.html" target="_blank" rel="noopener noreferrer" className="hover:text-flame-400 transition-colors">Privacy</a>
                    <a href="https://smart-guitar.com/refund.html" target="_blank" rel="noopener noreferrer" className="hover:text-flame-400 transition-colors">Refunds</a>
                </div>
            </div>
        </aside>
    )
}
