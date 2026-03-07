import { useAuthStore } from '@/stores/auth.store'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '@/router/routes'
import { LogOut, User } from 'lucide-react'
import { SubscriptionSection } from '@/features/subscription/components/SubscriptionSection'

export function ProfilePage() {
  const { email, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate(ROUTES.LOGIN)
  }

  return (
    <div className="p-4 max-w-3xl mx-auto" data-testid="profile-page">
      <h1 className="text-2xl font-bold mb-8">Profile</h1>

      {/* User info */}
      <div className="bg-charcoal-800 rounded-xl p-6 border border-charcoal-600 mb-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-charcoal-700 flex items-center justify-center">
            <User size={32} className="text-smoke-400" />
          </div>
          <div>
            <p className="text-smoke-100 font-semibold">{email || 'User'}</p>
            <p className="text-smoke-500 text-sm">Guitar enthusiast</p>
          </div>
        </div>
      </div>

      {/* Subscription */}
      <div className="mb-4">
        <SubscriptionSection />
      </div>

      {/* Sign out */}
      <button
        onClick={handleLogout}
        className="w-full py-3 bg-charcoal-700 border border-charcoal-600 text-smoke-300 rounded-lg flex items-center justify-center gap-2 hover:border-red-500 hover:text-red-500 transition-colors"
        data-testid="logout-button"
      >
        <LogOut size={18} />
        Sign out
      </button>
    </div>
  )
}
