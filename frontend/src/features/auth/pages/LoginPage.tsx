import { LoginForm } from '../components/LoginForm'
import { LegalFooter } from '@/components/layout/LegalFooter'
import { FlameLogo } from '@/components/shared/FlameLogo'

export function LoginPage() {
  return (
    <div
      className="relative flex flex-col overflow-y-auto bg-charcoal-950 px-4 h-(--vv-height)"
      data-testid="login-page"
    >
      <FlameLogo className="pointer-events-none absolute left-1/2 top-1/2 size-[min(96vw,96vh)] -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute inset-0 bg-charcoal-950/60" />
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center">
        <div className="w-full max-w-sm flex flex-col items-center gap-8">
          <LoginForm />
        </div>
      </div>
      <LegalFooter />
    </div>
  )
}
