import { Link, useLocation } from 'react-router-dom'
import { User } from 'lucide-react'
import { ROUTES } from '@/router/routes'

export function Header() {
  const location = useLocation()

  const authPaths: string[] = [ROUTES.LOGIN, ROUTES.REGISTER, ROUTES.CONFIRM_EMAIL, ROUTES.CALLBACK]
  const isAuthPage = authPaths.includes(location.pathname)

  if (isAuthPage) return null

  return (
    <header className="sticky top-0 z-40 bg-charcoal-900/80 backdrop-blur-md border-b border-charcoal-700 lg:hidden">
      <div className="flex items-center justify-between px-4 h-16">
        <Link to={ROUTES.LIBRARY} className="flex items-center gap-3">
          <img src="/art/logo.png" alt="Smart Guitar" className="w-8 h-8 rounded-full object-cover shrink-0" />
          <span className="text-2xl font-display tracking-wide text-smoke-100">
            SMART GUITAR
          </span>
        </Link>
        <Link
          to={ROUTES.PROFILE}
          className="p-2 rounded-full text-smoke-400 hover:text-flame-400 transition-colors"
          data-testid="profile-link"
        >
          <User size={20} />
        </Link>
      </div>
    </header>
  )
}
