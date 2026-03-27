import { Mic } from 'lucide-react'
import { PageBackground } from '@/components/shared/PageBackground'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageContainer } from '@/components/shared/PageContainer'
import { useTuner } from '../hooks/use-tuner'
import { TunerGauge } from '../components/TunerGauge'
import { NoteDisplay } from '../components/NoteDisplay'
import { StringSelector } from '../components/StringSelector'
import { TunerControls } from '../components/TunerControls'
import { TuningOffsetSelector } from '../components/TuningOffsetSelector'

export function TunerPage() {
  const {
    isListening,
    permissionDenied,
    detectedNote,
    detectedFrequency,
    cents,
    nearestString,
    selectedString,
    semitoneOffset,
    activeTuning,
    start,
    stop,
    selectString,
    setSemitoneOffset,
  } = useTuner()

  const handleToggle = () => {
    if (isListening) {
      stop()
    } else {
      start()
    }
  }

  return (
    <div className="relative h-full flex flex-col overflow-hidden" data-testid="tuner-page">
      <PageBackground />
      <div className="shrink-0">
        <PageHeader title="Tuner" icon={<Mic size={24} />} />
      </div>
      <PageContainer className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center gap-6 py-6 pb-[calc(5rem+env(safe-area-inset-bottom)+var(--vv-bottom-offset))] lg:pb-6">
        <TunerGauge cents={cents} active={isListening && !!detectedNote} />

        <NoteDisplay
          detectedNote={detectedNote}
          detectedFrequency={detectedFrequency}
          cents={cents}
          selectedString={selectedString}
          nearestString={nearestString}
          active={isListening}
        />

        <TuningOffsetSelector offset={semitoneOffset} onChange={setSemitoneOffset} />

        <StringSelector
          selectedString={selectedString}
          nearestString={nearestString}
          active={isListening}
          tuning={activeTuning}
          onSelect={selectString}
        />

        <TunerControls
          isListening={isListening}
          permissionDenied={permissionDenied}
          onToggle={handleToggle}
        />
      </PageContainer>
    </div>
  )
}
