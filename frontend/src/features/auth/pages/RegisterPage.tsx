import { RegisterForm } from '../components/RegisterForm'
import { LegalFooter } from '@/components/layout/LegalFooter'
import { FlameLogo } from '@/components/shared/FlameLogo'

export function RegisterPage() {
  return (
    <div
      className="relative flex flex-col overflow-y-auto bg-charcoal-950 px-4 h-(--vv-height)"
      data-testid="register-page"
    >
      <FlameLogo className="pointer-events-none absolute left-1/2 top-1/2 size-[min(96vw,96vh)] -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute inset-0 bg-charcoal-950/60" />
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center">
        <div className="w-full max-w-sm flex flex-col items-center gap-6">
          <div className="text-center">
            <h1 className="font-display text-5xl leading-[0.92] tracking-wide text-smoke-100">
              LEARN IT.<br />THEN PLAY IT<br />WITH THE <span className="text-fire-500">BAND.</span>
            </h1>
            <p className="mt-3 text-sm text-smoke-300">
              14-day Pro trial, no card. Hear it and Learn it stay free for every song.
            </p>
          </div>
          <RegisterForm />
        </div>
      </div>
      <LegalFooter />
    </div>
  )
}
