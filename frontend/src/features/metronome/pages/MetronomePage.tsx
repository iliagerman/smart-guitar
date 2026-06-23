import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { MetronomePanel } from '../components/MetronomePanel'

/**
 * Standalone metronome page for practice without loading a song.
 */
export function MetronomePage() {
  return (
    <div data-testid="metronome-page">
      <PageContainer>
        <PageHeader
          title="Metronome"
          subtitle="Practice with a visual pulse, click track, or both."
        />
        <MetronomePanel mode="standalone" />
      </PageContainer>
    </div>
  )
}
