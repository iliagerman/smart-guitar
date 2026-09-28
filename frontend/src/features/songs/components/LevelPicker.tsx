import { cn } from '@/lib/cn'
import { SKILL_LEVELS } from '@/features/practice/lib/practice-steps'
import type { SkillLevel } from '@/types/practice'

interface LevelPickerProps {
  value: SkillLevel | null
  onChange: (level: SkillLevel) => void
}

/** One-question onboarding: how much guitar the user already plays. */
export function LevelPicker({ value, onChange }: LevelPickerProps) {
  return (
    <div role="radiogroup" aria-label="Your level" className="flex flex-wrap gap-1.5" data-testid="level-picker">
      {SKILL_LEVELS.map(({ level, label }) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={value === level}
          onClick={() => onChange(level)}
          className={cn(
            'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60',
            value === level
              ? 'border-fire-500 bg-fire-500/15 text-fire-300'
              : 'border-white/10 bg-white/[0.04] text-smoke-300 hover:border-white/25',
          )}
          data-testid={`level-picker-${level}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
