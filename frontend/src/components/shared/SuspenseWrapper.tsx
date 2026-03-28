import { Suspense } from 'react'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

interface SuspenseWrapperProps {
  children: React.ReactNode
}

export function SuspenseWrapper({ children }: SuspenseWrapperProps) {
  return <Suspense fallback={<LoadingSpinner size="sm" />}>{children}</Suspense>
}
