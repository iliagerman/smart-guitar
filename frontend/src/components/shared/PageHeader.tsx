import { cn } from '@/lib/cn'

interface PageHeaderProps {
  title: string
  subtitle?: string
  /** Small mono line above the title, e.g. "Warm up · before you play". */
  eyebrow?: string
  icon?: React.ReactNode
  children?: React.ReactNode
  backgroundImage?: string | null
  className?: string
}

/** Stage-lit page header: a warm spotlight, a poster title and an optional toolbar. */
export function PageHeader({ title, subtitle, eyebrow, icon, children, backgroundImage, className }: PageHeaderProps) {
  return (
    <div className={cn('relative z-20 shrink-0 overflow-hidden border-b border-white/10 bg-stage-950/80 shadow-[0_18px_70px_rgba(0,0,0,0.4)] backdrop-blur-2xl', className)}>
      {backgroundImage && (
        <div
          className="pointer-events-none absolute inset-0 scale-110 bg-cover bg-center bg-no-repeat opacity-20 blur-xl"
          style={{ backgroundImage: `url(${backgroundImage})` }}
          aria-hidden="true"
        />
      )}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_120%_at_12%_-30%,rgba(249,115,22,0.32),transparent_70%),radial-gradient(40%_90%_at_95%_-20%,rgba(250,204,21,0.12),transparent_70%)]"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex items-center gap-4">
          {icon && (
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-fire-500 to-ember-600 text-white shadow-[0_10px_30px_rgba(249,115,22,0.35),inset_0_1px_0_rgba(255,255,255,0.25)]">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            {eyebrow && <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-fire-300">{eyebrow}</p>}
            <h1 className="truncate font-display text-4xl uppercase leading-[0.9] tracking-wide text-smoke-100 sm:text-5xl">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-smoke-400">{subtitle}</p>}
          </div>
        </div>
        {children && <div className="mt-5">{children}</div>}
      </div>
    </div>
  )
}
