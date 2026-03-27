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

/** Generic mixer/equalizer icon for the stem selector trigger button. */
export function MixerIcon({ size = 48, className }: StemIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('shrink-0', className)}>
      {/* Three vertical sliders */}
      {/* Slider 1 */}
      <line x1="12" y1="8" x2="12" y2="40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <rect x="8" y="14" width="8" height="6" rx="2" fill="currentColor" />
      {/* Slider 2 */}
      <line x1="24" y1="8" x2="24" y2="40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <rect x="20" y="24" width="8" height="6" rx="2" fill="currentColor" />
      {/* Slider 3 */}
      <line x1="36" y1="8" x2="36" y2="40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <rect x="32" y="18" width="8" height="6" rx="2" fill="currentColor" />
    </svg>
  )
}

export function DrumsIcon({ size = 48, className }: StemIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('shrink-0', className)}>
      {/* Hi-hat - left */}
      <ellipse cx="8" cy="22" rx="6" ry="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="8" y1="22" x2="8" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <line x1="4" y1="38" x2="12" y2="38" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Snare drum - center */}
      <ellipse cx="24" cy="28" rx="9" ry="3" fill="currentColor" />
      <rect x="15" y="28" width="18" height="8" fill="currentColor" />
      <ellipse cx="24" cy="36" rx="9" ry="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Floor tom - right */}
      <ellipse cx="40" cy="26" rx="6" ry="2.5" fill="currentColor" />
      <rect x="34" y="26" width="12" height="10" fill="currentColor" />
      <ellipse cx="40" cy="36" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Drumsticks */}
      <line x1="16" y1="10" x2="26" y2="24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="32" y1="10" x2="22" y2="24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function BassIcon({ size = 48, className }: StemIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('shrink-0', className)}>
      {/* Neck - longer and thinner than guitar */}
      <line x1="12" y1="4" x2="22" y2="24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* Tuning pegs - 4 for bass */}
      <line x1="9" y1="4" x2="13" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="10" y1="7" x2="6" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="11" y1="10" x2="7" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="13" x2="8" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Body - smaller than acoustic guitar */}
      <ellipse cx="30" cy="32" rx="8" ry="10" fill="currentColor" />
      {/* Pickups */}
      <rect x="27" y="28" width="6" height="2" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-charcoal-700" />
      <rect x="27" y="33" width="6" height="2" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-charcoal-700" />
      {/* Bridge */}
      <line x1="27" y1="39" x2="33" y2="39" stroke="currentColor" strokeWidth="1.5" className="text-charcoal-700" />
    </svg>
  )
}

export function PianoIcon({ size = 48, className }: StemIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('shrink-0', className)}>
      {/* White keys */}
      <rect x="2" y="8" width="6" height="32" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="8" y="8" width="6" height="32" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="14" y="8" width="6" height="32" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="20" y="8" width="6" height="32" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="26" y="8" width="6" height="32" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="32" y="8" width="6" height="32" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="38" y="8" width="6" height="32" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Black keys */}
      <rect x="6" y="8" width="4" height="20" rx="1" fill="currentColor" />
      <rect x="12" y="8" width="4" height="20" rx="1" fill="currentColor" />
      <rect x="24" y="8" width="4" height="20" rx="1" fill="currentColor" />
      <rect x="30" y="8" width="4" height="20" rx="1" fill="currentColor" />
      <rect x="36" y="8" width="4" height="20" rx="1" fill="currentColor" />
    </svg>
  )
}

export function OtherIcon({ size = 48, className }: StemIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('shrink-0', className)}>
      {/* Eighth note / quaver */}
      {/* Note head */}
      <ellipse cx="16" cy="34" rx="6" ry="5" transform="rotate(-20 16 34)" fill="currentColor" />
      {/* Stem */}
      <line x1="21" y1="32" x2="21" y2="8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* Flag */}
      <path d="M21 8c4 3 8 7 6 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}

const STEM_ICON_MAP: Record<string, React.FC<StemIconProps>> = {
  full_mix: FullMixIcon,
  vocals: VocalsIcon,
  guitar: GuitarIcon,
  drums: DrumsIcon,
  bass: BassIcon,
  piano: PianoIcon,
  other: OtherIcon,
  mixer: MixerIcon,
}

export function StemIcon({ stem, size = 48, className }: StemIconProps & { stem: string }) {
  const Icon = STEM_ICON_MAP[stem] || FullMixIcon
  return <Icon size={size} className={className} />
}
