import { useCallback, useMemo } from 'react'
import { analyticsTracker } from '@/lib/event-tracker'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePaywallStore } from '@/stores/paywall.store'
import { BandStage } from '@/features/practice/components/BandStage'
import { PracticePath } from '@/features/practice/components/PracticePath'
import { usePracticePath } from '@/features/practice/hooks/use-practice-path'
import { firstVerseLoop, songShapes } from '@/features/practice/lib/practice-steps'
import type { ChordEntry, LyricsSegment, SongDetail } from '@/types/song'
import { useCurrentChord } from '../../hooks/use-current-chord'

interface SongStageProps {
  songId: string
  detail: SongDetail
  songTitle: string
  displayChords: ChordEntry[]
  lyrics: LyricsSegment[]
  isPro: boolean
  stemVolumes?: Record<string, number>
  isPlaybackDisabled: boolean
  onSetStemVolume: (stemName: string, volume: number) => void
  onSeek: (time: number) => void
}

/**
 * The top of the player: the song's practice path and the band on stage.
 * Both drive the existing mixer — stem volumes, speed, loop and chord view.
 */
export function SongStage({
  songId,
  detail,
  songTitle,
  displayChords,
  lyrics,
  isPro,
  stemVolumes,
  isPlaybackDisabled,
  onSetStemVolume,
  onSeek,
}: SongStageProps) {
  const openPaywall = usePaywallStore((s) => s.openPaywall)
  const isFullSong = usePlaybackStore((s) => s.isFullSong)
  const activeStems = usePlaybackStore((s) => s.activeStems)
  const shapes = useMemo(() => songShapes(displayChords), [displayChords])
  const currentChord = useCurrentChord(displayChords)?.chord ?? null
  const hasVerseLoop = useMemo(() => firstVerseLoop(lyrics) !== null, [lyrics])

  const setStemVolumes = useCallback(
    (volumes: Record<string, number>) => {
      for (const [name, volume] of Object.entries(volumes)) onSetStemVolume(name, volume)
    },
    [onSetStemVolume],
  )

  const path = usePracticePath({
    songId,
    detail,
    songTitle,
    lyrics,
    shapes,
    isPro,
    onSetStemVolumes: setStemVolumes,
    onSeek,
  })

  const handleMemberVolumes = (volumes: Record<string, number>) => {
    setStemVolumes(volumes)
    analyticsTracker.track({
      event_type: 'band_member_toggled',
      event_category: 'player',
      song_id: songId,
      properties: { volumes, step: path.activeStep },
    })
  }

  const guitarSolo = !isFullSong && activeStems.length === 1 && activeStems[0] === 'guitar'
  const toggleGuitarSolo = () => {
    const playback = usePlaybackStore.getState()
    if (guitarSolo) playback.selectFullSong()
    else playback.setActiveStems(['guitar'])
  }

  const lockedMember = () =>
    openPaywall('band_member', {
      title: songTitle,
      learnedChords: path.progress.learned_chords.length,
      completedSteps: path.progress.completed_steps.length,
    })

  return (
    <div className="flex flex-col gap-2">
      <PracticePath
        progress={path.progress}
        activeStep={path.activeStep}
        isPro={isPro}
        shapes={shapes}
        currentChord={currentChord}
        stageFraction={path.stageFraction}
        hasVerseLoop={hasVerseLoop}
        onGoToStep={path.goToStep}
        onFinishStep={path.finishStep}
        onLeave={path.leavePath}
        onToggleShape={path.toggleShape}
      />
      <BandStage
        stemTypes={detail.stem_types}
        stems={detail.stems}
        stemVolumes={stemVolumes}
        locked={!!detail.stems_locked}
        guitarSolo={guitarSolo}
        disabled={isPlaybackDisabled}
        onSetVolumes={handleMemberVolumes}
        onToggleGuitarSolo={toggleGuitarSolo}
        onLockedMember={lockedMember}
      />
    </div>
  )
}
