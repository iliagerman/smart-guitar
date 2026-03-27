import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { AuthGuard } from '@/features/auth/components/AuthGuard'
import { SubscriptionGuard } from '@/features/subscription/components/SubscriptionGuard'
import { AdminGuard } from '@/features/analytics/components/AdminGuard'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { ROUTES } from './routes'

const LoginPage = lazy(() => import('@/features/auth/pages/LoginPage').then(m => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import('@/features/auth/pages/RegisterPage').then(m => ({ default: m.RegisterPage })))
const ConfirmEmailPage = lazy(() => import('@/features/auth/pages/ConfirmEmailPage').then(m => ({ default: m.ConfirmEmailPage })))
const CallbackPage = lazy(() => import('@/features/auth/pages/CallbackPage').then(m => ({ default: m.CallbackPage })))
const ProfilePage = lazy(() => import('@/features/auth/pages/ProfilePage').then(m => ({ default: m.ProfilePage })))
const AnalyticsDashboardPage = lazy(() => import('@/features/analytics/pages/AnalyticsDashboardPage').then(m => ({ default: m.AnalyticsDashboardPage })))
const SearchPage = lazy(() => import('@/features/search/pages/SearchPage').then(m => ({ default: m.SearchPage })))
const LibraryPage = lazy(() => import('@/features/library/pages/LibraryPage').then(m => ({ default: m.LibraryPage })))
const FavoritesPage = lazy(() => import('@/features/library/pages/FavoritesPage').then(m => ({ default: m.FavoritesPage })))
const SongDetailPage = lazy(() => import('@/features/player/pages/SongDetailPage').then(m => ({ default: m.SongDetailPage })))
const SubscriptionSuccessPage = lazy(() => import('@/features/subscription/pages/SubscriptionSuccessPage').then(m => ({ default: m.SubscriptionSuccessPage })))
const SubscriptionFailPage = lazy(() => import('@/features/subscription/pages/SubscriptionFailPage').then(m => ({ default: m.SubscriptionFailPage })))
const TunerPage = lazy(() => import('@/features/tuner/pages/TunerPage').then(m => ({ default: m.TunerPage })))

function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingSpinner size="sm" />}>{children}</Suspense>
}

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      // Public routes
      { path: ROUTES.LOGIN, element: <SuspenseWrapper><LoginPage /></SuspenseWrapper> },
      { path: ROUTES.REGISTER, element: <SuspenseWrapper><RegisterPage /></SuspenseWrapper> },
      { path: ROUTES.CONFIRM_EMAIL, element: <SuspenseWrapper><ConfirmEmailPage /></SuspenseWrapper> },
      { path: ROUTES.CALLBACK, element: <SuspenseWrapper><CallbackPage /></SuspenseWrapper> },

      // Protected + subscription-gated routes
      {
        path: ROUTES.SEARCH,
        element: (
          <AuthGuard>
            <SubscriptionGuard>
              <SuspenseWrapper><SearchPage /></SuspenseWrapper>
            </SubscriptionGuard>
          </AuthGuard>
        ),
      },
      {
        path: ROUTES.LIBRARY,
        element: (
          <AuthGuard>
            <SubscriptionGuard>
              <SuspenseWrapper><LibraryPage /></SuspenseWrapper>
            </SubscriptionGuard>
          </AuthGuard>
        ),
      },
      {
        path: ROUTES.FAVORITES,
        element: (
          <AuthGuard>
            <SubscriptionGuard>
              <SuspenseWrapper><FavoritesPage /></SuspenseWrapper>
            </SubscriptionGuard>
          </AuthGuard>
        ),
      },
      {
        path: ROUTES.ANALYTICS,
        element: (
          <AuthGuard>
            <AdminGuard>
              <SuspenseWrapper><AnalyticsDashboardPage /></SuspenseWrapper>
            </AdminGuard>
          </AuthGuard>
        ),
      },
      {
        path: ROUTES.SONG_DETAIL,
        element: (
          <AuthGuard>
            <SubscriptionGuard>
              <SuspenseWrapper><SongDetailPage /></SuspenseWrapper>
            </SubscriptionGuard>
          </AuthGuard>
        ),
      },
      // Tuner: auth only, no subscription required
      {
        path: ROUTES.TUNER,
        element: (
          <AuthGuard>
            <SuspenseWrapper><TunerPage /></SuspenseWrapper>
          </AuthGuard>
        ),
      },
      // Profile: auth only, no subscription required
      {
        path: ROUTES.PROFILE,
        element: (
          <AuthGuard>
            <SuspenseWrapper><ProfilePage /></SuspenseWrapper>
          </AuthGuard>
        ),
      },
      // Subscription result pages (auth only, no subscription required)
      {
        path: ROUTES.SUBSCRIPTION_SUCCESS,
        element: (
          <AuthGuard>
            <SuspenseWrapper><SubscriptionSuccessPage /></SuspenseWrapper>
          </AuthGuard>
        ),
      },
      {
        path: ROUTES.SUBSCRIPTION_FAIL,
        element: (
          <AuthGuard>
            <SuspenseWrapper><SubscriptionFailPage /></SuspenseWrapper>
          </AuthGuard>
        ),
      },

      // Default redirect
      { path: '/', element: <Navigate to={ROUTES.LIBRARY} replace /> },
      { path: '*', element: <Navigate to={ROUTES.LOGIN} replace /> },
    ],
  },
])
