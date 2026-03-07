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
    <div className={cn('relative z-20 shrink-0 bg-black overflow-hidden border-b border-charcoal-800/50', className)}>
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-15 blur-md scale-110 pointer-events-none"
        style={{ backgroundImage: `url(${backgroundImage || '/art/bg-texture.png'})` }}
        aria-hidden="true"
      />
      <div className="relative max-w-5xl mx-auto px-4 py-5">
        <div className="flex items-center gap-3">
          {icon && <div className="text-flame-400">{icon}</div>}
          <div>
            <h1 className="text-2xl font-bold leading-tight">{title}</h1>
            {subtitle && <p className="text-smoke-400 text-sm">{subtitle}</p>}
          </div>
        </div>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  )
}
