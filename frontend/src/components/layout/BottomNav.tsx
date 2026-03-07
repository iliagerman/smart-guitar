import { NavLink } from 'react-router-dom'
import { Search, Library, Heart, User } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ROUTES } from '@/router/routes'

const navItems = [
  { to: ROUTES.SEARCH, icon: Search, label: 'Search' },
  { to: ROUTES.LIBRARY, icon: Library, label: 'Library' },
  { to: ROUTES.FAVORITES, icon: Heart, label: 'Favorites' },
  { to: ROUTES.PROFILE, icon: User, label: 'Profile' },
]

export function BottomNav() {
  return (
    <nav
      className="fixed left-0 right-0 z-40 bg-charcoal-900 border-t border-charcoal-700 pb-[env(safe-area-inset-bottom)] lg:hidden"
      style={{ bottom: 'var(--vv-bottom-offset)' }}
      data-testid="bottom-nav"
    >
      <div className="flex items-center justify-around h-16">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-1 px-3 py-1 transition-colors',
                isActive ? 'text-flame-400' : 'text-smoke-600 hover:text-smoke-400'
              )
            }
            data-testid={`nav-${label.toLowerCase()}`}
          >
            <Icon size={20} />
            <span className="text-xs">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
