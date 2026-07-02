export interface LoopPlaybackState {
  isPlaying: boolean
  loopStart: number | null
  loopEnd: number | null
  currentTime: number
}

/**
 * Returns the time to seek back to when an active A/B loop should wrap
 * around, or null when no wrap is needed yet.
 */
export function getLoopSeekTarget(state: LoopPlaybackState): number | null {
  if (!state.isPlaying || state.loopStart === null || state.loopEnd === null) {
    return null
  }
  return state.currentTime >= state.loopEnd ? state.loopStart : null
}
