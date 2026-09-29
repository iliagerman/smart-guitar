import { describe, expect, it } from 'vitest'
import { completeStep, emptyProgress, firstVerseLoop, isPathComplete, songShapes, toggleLearnedChord } from './practice-steps'

describe('completeStep', () => {
  it('marks the step done and moves to the next unfinished step', () => {
    const next = completeStep(emptyProgress('s'), 1)
    expect(next.completed_steps).toEqual([1])
    expect(next.current_step).toBe(2)
  })

  it('skips steps that are already done', () => {
    const next = completeStep({ ...emptyProgress('s'), completed_steps: [3] }, 1)
    expect(next.completed_steps).toEqual([1, 3])
    expect(next.current_step).toBe(2)
  })

  it('stays on the last step once the song is complete', () => {
    const done = completeStep({ ...emptyProgress('s'), completed_steps: [1, 2], current_step: 3 }, 3)
    expect(done.completed_steps).toEqual([1, 2, 3])
    expect(done.current_step).toBe(3)
    expect(isPathComplete(done)).toBe(true)
    expect(isPathComplete({ completed_steps: [1, 2] })).toBe(false)
  })
})

describe('songShapes', () => {
  it('lists chords in order of first appearance, without no-chord markers', () => {
    const chords = [
      { chord: 'N', start_time: 0, end_time: 2 },
      { chord: 'Em', start_time: 2, end_time: 6 },
      { chord: 'G', start_time: 6, end_time: 10 },
      { chord: 'Em', start_time: 10, end_time: 14 },
      { chord: 'D', start_time: 14, end_time: 18 },
    ]
    expect(songShapes(chords)).toEqual(['Em', 'G', 'D'])
  })

  it('drops chords that only flash by (detector noise)', () => {
    const chords = [
      { chord: 'Em', start_time: 0, end_time: 50 },
      { chord: 'F#dim', start_time: 50, end_time: 50.5 },
      { chord: 'G', start_time: 50.5, end_time: 100 },
    ]
    expect(songShapes(chords)).toEqual(['Em', 'G'])
  })
})

describe('toggleLearnedChord', () => {
  it('keeps learned shapes in the song order', () => {
    const shapes = ['Em', 'G', 'D']
    let progress = toggleLearnedChord(emptyProgress('s'), 'D', shapes)
    progress = toggleLearnedChord(progress, 'Em', shapes)
    expect(progress.learned_chords).toEqual(['Em', 'D'])
    expect(toggleLearnedChord(progress, 'Em', shapes).learned_chords).toEqual(['D'])
  })
})

describe('firstVerseLoop', () => {
  it('loops the first few sung lines', () => {
    const lyrics = [
      { start: 10, end: 14 },
      { start: 14, end: 18 },
      { start: 18, end: 22 },
      { start: 22, end: 26 },
      { start: 26, end: 30 },
    ]
    expect(firstVerseLoop(lyrics)).toEqual({ start: 10, end: 26 })
  })

  it('caps the loop at about 30 seconds', () => {
    const lyrics = [
      { start: 0, end: 20 },
      { start: 20, end: 40 },
    ]
    expect(firstVerseLoop(lyrics)).toEqual({ start: 0, end: 20 })
  })

  it('has no loop without lyrics', () => {
    expect(firstVerseLoop([])).toBeNull()
  })
})
