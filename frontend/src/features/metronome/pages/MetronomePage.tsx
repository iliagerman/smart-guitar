import { Timer } from 'lucide-react'
import { PageBackground } from '@/components/shared/PageBackground'
import { PageHeader } from '@/components/shared/PageHeader'
import { MetronomePanel } from '../components/MetronomePanel'

/**
 * Standalone metronome page for practice without loading a song.
 */
export function MetronomePage() {
  return (
    <div className="relative flex h-full flex-col overflow-hidden" data-testid="metronome-page">
      <PageBackground />
      <PageHeader
        title="Metronome"
        subtitle="Practice a steady pulse and synchronized strumming patterns."
        icon={<Timer size={24} />}
      />
      <div className="relative z-10 flex min-h-0 flex-1 px-4 py-4 pb-[calc(5rem+env(safe-area-inset-bottom)+var(--vv-bottom-offset))] lg:pb-4">
        <MetronomePanel mode="standalone" />
      </div>
    </div>
  )
}
