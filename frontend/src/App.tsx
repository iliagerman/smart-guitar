import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { queryClient } from './config/query-client'
import { router } from './router'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { InstallPrompt } from './components/shared/InstallPrompt'
import { JobWatcher } from './components/shared/JobWatcher'
import { VisualViewportVars } from './components/layout/VisualViewportVars'

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <VisualViewportVars />
        <InstallPrompt />
        <JobWatcher />
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            className: 'bg-charcoal-900 border-charcoal-700 text-smoke-100',
          }}
        />
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
