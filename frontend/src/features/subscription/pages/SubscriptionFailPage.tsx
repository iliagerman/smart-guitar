import { useNavigate } from 'react-router-dom'
import { XCircle } from 'lucide-react'
import { ROUTES } from '@/router/routes'

export function SubscriptionFailPage() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <XCircle className="text-red-400" size={56} />
      <h1 className="text-2xl font-bold text-smoke-100">Payment Failed</h1>
      <p className="text-smoke-400 text-center max-w-md">
        Something went wrong with your payment. Please try again.
      </p>
      <button
        onClick={() => navigate(ROUTES.LIBRARY, { replace: true })}
        className="px-6 py-2.5 bg-flame-500 text-white rounded-lg font-medium hover:bg-flame-600 transition-colors"
      >
        Go Back
      </button>
    </div>
  )
}
