import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { SidebarNav } from './SidebarNav'
import { useEventTracker } from '@/hooks/use-event-tracker'
import { ROUTES } from '@/router/routes'

export function AppShell() {
  const location = useLocation()
  useEventTracker()

  const authPaths: string[] = [ROUTES.LOGIN, ROUTES.REGISTER, ROUTES.CONFIRM_EMAIL, ROUTES.CALLBACK]
  const isAuthPage = authPaths.includes(location.pathname)

  return (
    <div className="bg-charcoal-950 overflow-hidden" style={{ height: 'var(--vv-height)' }}>
      {isAuthPage ? (
        <main style={{ minHeight: 'var(--vv-height)' }}>
          <Outlet />
        </main>
      ) : (
        <div className="flex overflow-hidden" style={{ height: 'var(--vv-height)' }}>
          <SidebarNav />
          <div className="flex-1 min-w-0 flex flex-col">
            <main
              className="flex-1 min-h-0 flex flex-col overflow-hidden"
            >
              <Outlet />
            </main>
            <BottomNav />
          </div>
        </div>
      )}
    </div>
  )
}
