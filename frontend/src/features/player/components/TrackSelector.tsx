import { cn } from '@/lib/cn'
import { type StemName } from '@/stores/playback.store'
import { type StemType } from '@/types/song'
import { StemIcon } from './StemIcons'

interface TrackSelectorProps {
  activeStem: StemName
  onStemChange: (stem: StemName) => void
  availableStems: Record<string, string | null>
  stemTypes: StemType[]
}

interface StemOption {
  value: string
  label: string
  available: boolean
}

function buildStemOptions(stemTypes: StemType[], availableStems: Record<string, string | null>): StemOption[] {
  const fullMix: StemOption = {
    value: 'full_mix',
    label: 'Full Mix',
    available: true,
  }

  const stems: StemOption[] = stemTypes.map(({ name, label }) => ({
    value: name,
    label,
    available: !!availableStems[name],
  }))

  return [fullMix, ...stems]
}

export function TrackSelector({ activeStem, onStemChange, availableStems, stemTypes }: TrackSelectorProps) {
  const options = buildStemOptions(stemTypes, availableStems)
  const availableOptions = options.filter((o) => o.available)
  const activeOption = options.find((o) => o.value === activeStem) ?? options[0]

  function cycleNext() {
    const currentIdx = availableOptions.findIndex((o) => o.value === activeStem)
    const nextIdx = (currentIdx + 1) % availableOptions.length
    onStemChange(availableOptions[nextIdx].value as StemName)
  }

  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center rounded-lg w-16 h-16',
        'bg-charcoal-700 border border-charcoal-600 text-flame-400/70',
        'hover:border-flame-400/30 hover:text-flame-400 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
      )}
      onClick={cycleNext}
      title={activeOption.label}
      aria-label={`Track: ${activeOption.label}. Click to cycle.`}
      data-testid="track-selector"
    >
      <StemIcon stem={activeOption.value} size={48} />
    </button>
  )
}
