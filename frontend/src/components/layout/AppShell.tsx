import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { SidebarNav } from './SidebarNav'
import { ROUTES } from '@/router/routes'
import { cn } from '@/lib/cn'

export function AppShell() {
  const location = useLocation()

  const authPaths: string[] = [ROUTES.LOGIN, ROUTES.REGISTER, ROUTES.CONFIRM_EMAIL, ROUTES.CALLBACK]
  const isAuthPage = authPaths.includes(location.pathname)

  return (
    <div className="bg-charcoal-950" style={{ minHeight: 'var(--vv-height)' }}>
      {isAuthPage ? (
        <main style={{ minHeight: 'var(--vv-height)' }}>
          <Outlet />
        </main>
      ) : (
        <div className="flex overflow-hidden" style={{ height: 'var(--vv-height)' }}>
          <SidebarNav />
          <div className="flex-1 min-w-0 flex flex-col">
            <main
              className={cn(
                'flex-1 overflow-y-auto',
                // Leave room for the fixed bottom nav (h-16) + device safe area.
                // Without this, the last list item can sit underneath the nav on mobile.
                'pb-[calc(5rem+env(safe-area-inset-bottom)+var(--vv-bottom-offset))] lg:pb-0'
              )}
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
