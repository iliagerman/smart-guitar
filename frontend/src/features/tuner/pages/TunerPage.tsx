import { Mic } from 'lucide-react'
import { PageBackground } from '@/components/shared/PageBackground'
import { PageHeader } from '@/components/shared/PageHeader'
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
    <div className="relative flex h-full flex-col overflow-hidden" data-testid="tuner-page">
      <PageBackground />
      <PageHeader title="Tuner" eyebrow="Before you play" subtitle="Play one string at a time. Green means you’re in tune." icon={<Mic size={24} />} />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-4 py-4 pb-[calc(5rem+env(safe-area-inset-bottom)+var(--vv-bottom-offset))] lg:pb-4">
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col justify-between rounded-[2rem] border border-white/[0.08] bg-stage-950/75 p-5 shadow-[0_0_70px_rgba(249,115,22,0.1),0_24px_90px_rgba(0,0,0,0.5)] sm:p-8">
          <div className="flex min-h-0 flex-1 flex-col justify-center gap-5 sm:gap-7">
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
          </div>

          <div className="mt-6 shrink-0">
            <TunerControls
              isListening={isListening}
              permissionDenied={permissionDenied}
              onToggle={handleToggle}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
