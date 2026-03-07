import { useMemo } from 'react'
import { usePlaybackStore } from '@/stores/playback.store'
import type { ChordEntry } from '@/types/song'

export function useChordSync(chords: ChordEntry[]) {
  const currentTime = usePlaybackStore((s) => s.currentTime)

  const activeChordIndex = useMemo(() => {
    return chords.findIndex(
      (c) => currentTime >= c.start_time && currentTime < c.end_time
    )
  }, [chords, currentTime])

  return { activeChordIndex }
}
