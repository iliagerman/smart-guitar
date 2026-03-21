import { cn } from '@/lib/cn'

interface StemIconProps {
  size?: number
  className?: string
}

export function FullMixIcon({ size = 48, className }: StemIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('shrink-0', className)}>
      {/* Singer with mic stand */}
      <circle cx="10" cy="10" r="3" fill="currentColor" />
      <path d="M10 14c-3 0-5 2-5 5v6h2v8h6v-8h2v-6c0-3-2-5-5-5z" fill="currentColor" />
      <line x1="16" y1="12" x2="16" y2="20" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16" cy="11" r="1.5" fill="currentColor" />
      {/* Guitarist */}
      <circle cx="26" cy="10" r="3" fill="currentColor" />
      <path d="M26 14c-3 0-5 2-5 5v6h2v8h6v-8h2v-6c0-3-2-5-5-5z" fill="currentColor" />
      <path d="M30 18l4-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <ellipse cx="35" cy="10" rx="2" ry="3" stroke="currentColor" strokeWidth="1.2" fill="none" />
      {/* Drummer */}
      <circle cx="42" cy="10" r="3" fill="currentColor" />
      <path d="M42 14c-2.5 0-4 1.5-4 4v4h8v-4c0-2.5-1.5-4-4-4z" fill="currentColor" />
      <ellipse cx="42" cy="26" rx="5" ry="2.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="37" y1="26" x2="37" y2="33" stroke="currentColor" strokeWidth="1.2" />
      <line x1="47" y1="26" x2="47" y2="33" stroke="currentColor" strokeWidth="1.2" />
      <line x1="40" y1="18" x2="36" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="44" y1="18" x2="48" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function VocalsIcon({ size = 48, className }: StemIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('shrink-0', className)}>
      {/* Head */}
      <circle cx="20" cy="12" r="5" fill="currentColor" />
      {/* Body */}
      <path d="M20 18c-5 0-8 3-8 8v5h4v10h8v-10h4v-5c0-5-3-8-8-8z" fill="currentColor" />
      {/* Mic stand */}
      <line x1="33" y1="12" x2="33" y2="36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* Mic head */}
      <rect x="30" y="8" width="6" height="5" rx="3" fill="currentColor" />
      {/* Mic base */}
      <line x1="29" y1="36" x2="37" y2="36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function GuitarIcon({ size = 48, className }: StemIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('shrink-0', className)}>
      {/* Neck */}
      <line x1="14" y1="6" x2="22" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* Tuning pegs */}
      <line x1="11" y1="5" x2="15" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="8" x2="8" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="13" y1="11" x2="9" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Body */}
      <ellipse cx="28" cy="28" rx="10" ry="12" fill="currentColor" />
      {/* Sound hole */}
      <circle cx="28" cy="28" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-charcoal-700" />
      {/* Bridge */}
      <line x1="25" y1="35" x2="31" y2="35" stroke="currentColor" strokeWidth="1.5" className="text-charcoal-700" />
    </svg>
  )
}

export function NoGuitarIcon({ size = 48, className }: StemIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('shrink-0', className)}>
      {/* Neck */}
      <line x1="14" y1="6" x2="22" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      {/* Tuning pegs */}
      <line x1="11" y1="5" x2="15" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <line x1="12" y1="8" x2="8" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <line x1="13" y1="11" x2="9" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      {/* Body */}
      <ellipse cx="28" cy="28" rx="10" ry="12" fill="currentColor" opacity="0.5" />
      {/* Sound hole */}
      <circle cx="28" cy="28" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-charcoal-700" opacity="0.5" />
      {/* X slash */}
      <line x1="8" y1="8" x2="40" y2="40" stroke="#ef4444" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="40" y1="8" x2="8" y2="40" stroke="#ef4444" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  )
}

export function VocalsGuitarIcon({ size = 48, className }: StemIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('shrink-0', className)}>
      {/* Singer - left side */}
      <circle cx="12" cy="10" r="3.5" fill="currentColor" />
      <path d="M12 14c-3.5 0-6 2.5-6 6v4h3v8h6v-8h3v-4c0-3.5-2.5-6-6-6z" fill="currentColor" />
      {/* Mic */}
      <line x1="21" y1="10" x2="21" y2="28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="19" y="7" width="4" height="4" rx="2" fill="currentColor" />
      {/* Guitar - right side */}
      <line x1="30" y1="8" x2="35" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="28" y1="7" x2="31" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="29" y1="10" x2="26" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <ellipse cx="38" cy="28" rx="7" ry="9" fill="currentColor" />
      <circle cx="38" cy="28" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-charcoal-700" />
    </svg>
  )
}

const STEM_ICON_MAP: Record<string, React.FC<StemIconProps>> = {
  full_mix: FullMixIcon,
  vocals: VocalsIcon,
  guitar: GuitarIcon,
  guitar_removed: NoGuitarIcon,
  vocals_guitar: VocalsGuitarIcon,
}

export function StemIcon({ stem, size = 48, className }: StemIconProps & { stem: string }) {
  const Icon = STEM_ICON_MAP[stem] || FullMixIcon
  return <Icon size={size} className={className} />
}
