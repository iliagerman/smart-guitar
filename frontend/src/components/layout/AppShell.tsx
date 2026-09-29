import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { SidebarNav } from './SidebarNav'
import { useEventTracker } from '@/hooks/use-event-tracker'
import { ROUTES } from '@/router/routes'
import { TrialCountdownBanner } from '@/features/subscription/components/TrialCountdownBanner'
import { PaywallDialog } from '@/features/subscription/components/PaywallDialog'

export function AppShell() {
  const location = useLocation()
  useEventTracker()

  const authPaths: string[] = [ROUTES.LOGIN, ROUTES.REGISTER, ROUTES.CONFIRM_EMAIL, ROUTES.CALLBACK]
  const isAuthPage = authPaths.includes(location.pathname)

  return (
    <div className="h-[var(--vv-height)] overflow-hidden bg-stage-950">
      {isAuthPage ? (
        <main className="min-h-[var(--vv-height)]">
          <Outlet />
        </main>
      ) : (
        <div className="flex h-[var(--vv-height)] overflow-hidden">
          <SidebarNav />
          <div className="flex-1 min-w-0 flex flex-col">
            <TrialCountdownBanner />
            <main
              className="flex-1 min-h-0 flex flex-col overflow-hidden"
            >
              <Outlet />
            </main>
            <BottomNav />
          </div>
          <PaywallDialog />
        </div>
      )}
    </div>
  )
}
