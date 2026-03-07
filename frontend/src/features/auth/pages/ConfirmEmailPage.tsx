import { ConfirmEmailForm } from '../components/ConfirmEmailForm'

export function ConfirmEmailPage() {
  return (
    <div className="min-h-(--vv-height) flex flex-col items-center justify-center bg-charcoal-950 bg-[url('/art/hero-bg.jpg')] bg-cover bg-center bg-no-repeat px-4" data-testid="confirm-page">
      <div className="absolute inset-0 bg-charcoal-950/80" />
      <div className="relative z-10 w-full max-w-sm flex flex-col items-center gap-8">
        <img src="/art/logo.png" alt="Smart Guitar" className="w-24 h-24 rounded-full object-cover shadow-lg shadow-flame-400/20" />
        <ConfirmEmailForm />
      </div>
    </div>
  )
}
