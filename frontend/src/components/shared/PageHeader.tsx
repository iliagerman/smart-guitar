import { cn } from '@/lib/cn'

interface PageHeaderProps {
  title: string
  subtitle?: string
  icon?: React.ReactNode
  children?: React.ReactNode
  backgroundImage?: string | null
  className?: string
}

export function PageHeader({ title, subtitle, icon, children, backgroundImage, className }: PageHeaderProps) {
  return (
    <div className={cn('relative z-20 shrink-0 overflow-hidden border-b border-white/10 bg-charcoal-950/80 shadow-[0_18px_70px_rgba(0,0,0,0.36)] backdrop-blur-2xl', className)}>
      <div
        className="pointer-events-none absolute inset-0 scale-110 bg-cover bg-center bg-no-repeat opacity-20 blur-xl"
        style={{ backgroundImage: `url(${backgroundImage || '/art/bg-texture.png'})` }}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(250,204,21,0.16),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.06),transparent)]" />
      <div className="relative mx-auto max-w-5xl px-4 py-5">
        <div className="flex items-center gap-3">
          {icon && <div className="grid size-11 place-items-center rounded-2xl border border-flame-400/20 bg-flame-400/10 text-flame-300 shadow-[0_0_26px_rgba(250,204,21,0.16)]">{icon}</div>}
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-black leading-none tracking-[-0.04em] text-smoke-100">{title}</h1>
            {subtitle && <p className="mt-1 text-sm font-medium text-smoke-400">{subtitle}</p>}
          </div>
        </div>
        {children && <div className="mt-5">{children}</div>}
      </div>
    </div>
  )
}
