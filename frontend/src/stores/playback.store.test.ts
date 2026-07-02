import { describe, it, expect, beforeEach } from 'vitest'
import { usePlaybackStore } from './playback.store'

describe('playback.store A/B loop', () => {
  beforeEach(() => {
    usePlaybackStore.getState().reset()
  })

  it('starts with no loop points set', () => {
    const state = usePlaybackStore.getState()
    expect(state.loopStart).toBeNull()
    expect(state.loopEnd).toBeNull()
  })

  it('first tap sets the A marker only', () => {
    usePlaybackStore.getState().tapLoopMarker(10)
    const state = usePlaybackStore.getState()
    expect(state.loopStart).toBe(10)
    expect(state.loopEnd).toBeNull()
  })

  it('second tap sets the B marker and activates the loop', () => {
    usePlaybackStore.getState().tapLoopMarker(10)
    usePlaybackStore.getState().tapLoopMarker(20)
    const state = usePlaybackStore.getState()
    expect(state.loopStart).toBe(10)
    expect(state.loopEnd).toBe(20)
  })

  it('swaps A and B when the second tap happens before the first', () => {
    usePlaybackStore.getState().tapLoopMarker(20)
    usePlaybackStore.getState().tapLoopMarker(10)
    const state = usePlaybackStore.getState()
    expect(state.loopStart).toBe(10)
    expect(state.loopEnd).toBe(20)
  })

  it('third tap clears both markers', () => {
    usePlaybackStore.getState().tapLoopMarker(10)
    usePlaybackStore.getState().tapLoopMarker(20)
    usePlaybackStore.getState().tapLoopMarker(15)
    const state = usePlaybackStore.getState()
    expect(state.loopStart).toBeNull()
    expect(state.loopEnd).toBeNull()
  })

  it('clearLoop resets both markers regardless of phase', () => {
    usePlaybackStore.getState().tapLoopMarker(10)
    usePlaybackStore.getState().clearLoop()
    const state = usePlaybackStore.getState()
    expect(state.loopStart).toBeNull()
    expect(state.loopEnd).toBeNull()
  })

  it('setCurrentSong clears any active loop', () => {
    usePlaybackStore.getState().tapLoopMarker(10)
    usePlaybackStore.getState().tapLoopMarker(20)
    usePlaybackStore.getState().setCurrentSong('song-2')
    const state = usePlaybackStore.getState()
    expect(state.loopStart).toBeNull()
    expect(state.loopEnd).toBeNull()
  })
})

describe('playback.store A/B loop minimum length', () => {
  beforeEach(() => {
    usePlaybackStore.getState().reset()
  })

  it('ignores a second tap too close after the A marker', () => {
    usePlaybackStore.getState().tapLoopMarker(10)
    usePlaybackStore.getState().tapLoopMarker(10.2)
    const state = usePlaybackStore.getState()
    expect(state.loopStart).toBe(10)
    expect(state.loopEnd).toBeNull()
  })

  it('ignores a second tap too close before the A marker', () => {
    usePlaybackStore.getState().tapLoopMarker(10)
    usePlaybackStore.getState().tapLoopMarker(9.8)
    const state = usePlaybackStore.getState()
    expect(state.loopStart).toBe(10)
    expect(state.loopEnd).toBeNull()
  })

  it('ignores a second tap at exactly the A marker time', () => {
    usePlaybackStore.getState().tapLoopMarker(10)
    usePlaybackStore.getState().tapLoopMarker(10)
    const state = usePlaybackStore.getState()
    expect(state.loopStart).toBe(10)
    expect(state.loopEnd).toBeNull()
  })
})
