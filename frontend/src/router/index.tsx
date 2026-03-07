import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { AuthGuard } from '@/features/auth/components/AuthGuard'
import { SubscriptionGuard } from '@/features/subscription/components/SubscriptionGuard'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { RegisterPage } from '@/features/auth/pages/RegisterPage'
import { ConfirmEmailPage } from '@/features/auth/pages/ConfirmEmailPage'
import { CallbackPage } from '@/features/auth/pages/CallbackPage'
import { ProfilePage } from '@/features/auth/pages/ProfilePage'
import { SearchPage } from '@/features/search/pages/SearchPage'
import { LibraryPage } from '@/features/library/pages/LibraryPage'
import { FavoritesPage } from '@/features/library/pages/FavoritesPage'
import { SongDetailPage } from '@/features/player/pages/SongDetailPage'
import { SubscriptionSuccessPage } from '@/features/subscription/pages/SubscriptionSuccessPage'
import { SubscriptionFailPage } from '@/features/subscription/pages/SubscriptionFailPage'
import { ROUTES } from './routes'

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      // Public routes
      { path: ROUTES.LOGIN, element: <LoginPage /> },
      { path: ROUTES.REGISTER, element: <RegisterPage /> },
      { path: ROUTES.CONFIRM_EMAIL, element: <ConfirmEmailPage /> },
      { path: ROUTES.CALLBACK, element: <CallbackPage /> },

      // Protected + subscription-gated routes
      {
        path: ROUTES.SEARCH,
        element: (
          <AuthGuard>
            <SubscriptionGuard>
              <SearchPage />
            </SubscriptionGuard>
          </AuthGuard>
        ),
      },
      {
        path: ROUTES.LIBRARY,
        element: (
          <AuthGuard>
            <SubscriptionGuard>
              <LibraryPage />
            </SubscriptionGuard>
          </AuthGuard>
        ),
      },
      {
        path: ROUTES.FAVORITES,
        element: (
          <AuthGuard>
            <SubscriptionGuard>
              <FavoritesPage />
            </SubscriptionGuard>
          </AuthGuard>
        ),
      },
      {
        path: ROUTES.SONG_DETAIL,
        element: (
          <AuthGuard>
            <SubscriptionGuard>
              <SongDetailPage />
            </SubscriptionGuard>
          </AuthGuard>
        ),
      },
      // Profile: auth only, no subscription required
      {
        path: ROUTES.PROFILE,
        element: (
          <AuthGuard>
            <ProfilePage />
          </AuthGuard>
        ),
      },
      // Subscription result pages (auth only, no subscription required)
      {
        path: ROUTES.SUBSCRIPTION_SUCCESS,
        element: (
          <AuthGuard>
            <SubscriptionSuccessPage />
          </AuthGuard>
        ),
      },
      {
        path: ROUTES.SUBSCRIPTION_FAIL,
        element: (
          <AuthGuard>
            <SubscriptionFailPage />
          </AuthGuard>
        ),
      },

      // Default redirect
      { path: '/', element: <Navigate to={ROUTES.LIBRARY} replace /> },
      { path: '*', element: <Navigate to={ROUTES.LOGIN} replace /> },
    ],
  },
])
