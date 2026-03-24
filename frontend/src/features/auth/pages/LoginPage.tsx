import { LoginForm } from '../components/LoginForm'
import { LegalFooter } from '@/components/layout/LegalFooter'

export function LoginPage() {
  return (
    <div
      className="relative flex flex-col overflow-y-auto bg-charcoal-950 px-4"
      style={{ height: 'var(--vv-height)' }}
      data-testid="login-page"
    >
      <video
        src="/guitar.mp4"
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-charcoal-950/70" />
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center">
        <div className="w-full max-w-sm flex flex-col items-center gap-8">
          <LoginForm />
        </div>
      </div>
      <LegalFooter />
    </div>
  )
}
