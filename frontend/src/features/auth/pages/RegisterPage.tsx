import { RegisterForm } from '../components/RegisterForm'
import { LegalFooter } from '@/components/layout/LegalFooter'

export function RegisterPage() {
  return (
    <div
      className="flex flex-col overflow-y-auto bg-charcoal-950 bg-[url('/art/hero-bg.jpg')] bg-cover bg-center bg-no-repeat px-4"
      style={{ height: 'var(--vv-height)' }}
      data-testid="register-page"
    >
      <div className="absolute inset-0 bg-charcoal-950/80" />
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center">
        <div className="w-full max-w-sm flex flex-col items-center gap-8">
          <img src="/art/logo.png" alt="Smart Guitar" className="w-24 h-24 rounded-full object-cover shadow-lg shadow-flame-400/20" />
          <RegisterForm />
        </div>
      </div>
      <LegalFooter />
    </div>
  )
}
