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
    <div className="relative min-h-full flex flex-col" data-testid="tuner-page">
      <PageBackground />
      <PageHeader title="Tuner" icon={<Mic size={24} />} />
      <PageContainer className="flex flex-col items-center gap-6 py-6">
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
