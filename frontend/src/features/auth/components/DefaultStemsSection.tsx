import { Music } from 'lucide-react'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { cn } from '@/lib/cn'
import { StemIcon } from '@/features/player/components/StemIcons'

interface StemToggleRowProps {
  stemName: string
  label: string
  active: boolean
  onToggle: () => void
}

function StemToggleRow({ stemName, label, active, onToggle }: StemToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <StemIcon stem={stemName} size={20} className="text-smoke-300" />
        <p className="text-smoke-100 text-sm font-medium">{label}</p>
      </div>
      <button
        role="switch"
        aria-checked={active}
        onClick={onToggle}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
          active ? 'bg-flame-500' : 'bg-charcoal-600',
        )}
        data-testid={`default-stem-toggle-${stemName}`}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
            active ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  )
}

const ALL_STEMS = [
  { name: 'vocals', label: 'Vocals' },
  { name: 'guitar', label: 'Guitar' },
  { name: 'drums', label: 'Drums' },
  { name: 'bass', label: 'Bass' },
  { name: 'piano', label: 'Piano' },
  { name: 'other', label: 'Other' },
]

/**
 * Settings section that lets users choose which stems are enabled by default
 * when opening a song.
 */
export function DefaultStemsSection() {
  const defaultStems = usePlayerPrefsStore((s) => s.defaultStems)
  const setDefaultStems = usePlayerPrefsStore((s) => s.setDefaultStems)

  function toggleStem(stemName: string) {
    const idx = defaultStems.indexOf(stemName)
    if (idx >= 0) {
      setDefaultStems(defaultStems.filter((s) => s !== stemName))
    } else {
      setDefaultStems([...defaultStems, stemName])
    }
  }

  return (
    <div className="bg-charcoal-800 rounded-xl p-6 border border-charcoal-600">
      <h2 className="text-lg font-semibold text-smoke-100 mb-1 flex items-center gap-2">
        <Music size={20} />
        Default Stems
      </h2>
      <p className="text-smoke-500 text-xs mb-4">
        Choose which stems are enabled when you open a song. If none are selected, the full song plays.
      </p>

      <div className="space-y-3">
        {ALL_STEMS.map(({ name, label }) => (
          <StemToggleRow
            key={name}
            stemName={name}
            label={label}
            active={defaultStems.includes(name)}
            onToggle={() => toggleStem(name)}
          />
        ))}
      </div>
    </div>
  )
}
