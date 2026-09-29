import { analyticsTracker } from '@/lib/event-tracker'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePaywallStore } from '@/stores/paywall.store'
import { BandStage } from '@/features/practice/components/BandStage'
import type { SongDetail } from '@/types/song'

interface SongStageProps {
  songId: string
  detail: SongDetail
  stemVolumes?: Record<string, number>
  isPlaybackDisabled: boolean
  onSetStemVolume: (stemName: string, volume: number) => void
}

/** The top of the player: the band on stage, driving the stem volumes. */
export function SongStage({ songId, detail, stemVolumes, isPlaybackDisabled, onSetStemVolume }: SongStageProps) {
  const openPaywall = usePaywallStore((s) => s.openPaywall)
  const isFullSong = usePlaybackStore((s) => s.isFullSong)
  const activeStems = usePlaybackStore((s) => s.activeStems)

  const handleMemberVolumes = (volumes: Record<string, number>) => {
    for (const [name, volume] of Object.entries(volumes)) onSetStemVolume(name, volume)
    analyticsTracker.track({
      event_type: 'band_member_toggled',
      event_category: 'player',
      song_id: songId,
      properties: { volumes },
    })
  }

  const guitarSolo = !isFullSong && activeStems.length === 1 && activeStems[0] === 'guitar'
  const toggleGuitarSolo = () => {
    const playback = usePlaybackStore.getState()
    if (guitarSolo) playback.selectFullSong()
    else playback.setActiveStems(['guitar'])
  }

  return (
    <BandStage
      stemTypes={detail.stem_types}
      stems={detail.stems}
      stemVolumes={stemVolumes}
      locked={!!detail.stems_locked}
      guitarSolo={guitarSolo}
      disabled={isPlaybackDisabled}
      onSetVolumes={handleMemberVolumes}
      onToggleGuitarSolo={toggleGuitarSolo}
      onLockedMember={() => openPaywall('band_member')}
    />
  )
}
