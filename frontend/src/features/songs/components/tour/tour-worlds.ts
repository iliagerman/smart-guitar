import type { SetlistMode } from '@/types/practice'

/** The scenery a world's backdrop animates while you scroll through it. */
export type SceneKind = 'backstage' | 'arena' | 'campfire' | 'sunrise' | 'moonlit' | 'neon' | 'pulse' | 'sea' | 'synth'

export interface WorldTheme {
  scene: SceneKind
  /** Huge outlined word drifting behind the stop, like a venue sign. */
  ghost: string
  /** Where this stop of the tour "happens". */
  place: string
  accent: string
}

export const BACKSTAGE: WorldTheme = { scene: 'backstage', ghost: 'BACKSTAGE', place: 'Backstage', accent: '#f97316' }

/** The charts play the stadium: lighters up, beams sweeping the crowd. */
export const STADIUM: WorldTheme = { scene: 'arena', ghost: 'LIGHTERS UP', place: 'The stadium', accent: '#fbbf24' }

const WORLDS: Record<string, WorldTheme> = {
  hits: STADIUM,
  'israeli-hits': { ...STADIUM, ghost: 'שרים ביחד' },
  campfire: { scene: 'campfire', ghost: 'CAMPFIRE', place: 'By the fire', accent: '#ff8a3d' },
  'first-songs': { scene: 'sunrise', ghost: 'FIRST LIGHT', place: 'Morning practice', accent: '#ffb38a' },
  'slow-pretty': { scene: 'moonlit', ghost: 'MOONLIGHT', place: 'After midnight', accent: '#c3c9ff' },
  'band-room': { scene: 'neon', ghost: 'TURN IT UP', place: 'The rock club', accent: '#f472d0' },
  'jam-drummer': { scene: 'pulse', ghost: 'BOOM · TSS', place: 'Rehearsal room', accent: '#ff5566' },
  israeli: { scene: 'sea', ghost: 'שירים', place: 'On the beach', accent: '#44dcc9' },
  challenge: { scene: 'synth', ghost: 'LEVEL UP', place: 'Main stage', accent: '#6ae8ff' },
}

export function worldFor(setlistId: string): WorldTheme {
  return WORLDS[setlistId] ?? { ...BACKSTAGE, ghost: 'SETLIST', place: 'Tonight' }
}

export const MODE_LABEL: Record<SetlistMode, string> = {
  play_along: 'Take the guitarist’s seat',
  drums_bass: 'Keep only drums and bass',
  learn: 'Learn it step by step',
}

/** Every scene, so the backdrop can keep them all mounted and crossfade. */
export const ALL_SCENES: readonly SceneKind[] = ['backstage', 'arena', 'campfire', 'sunrise', 'moonlit', 'neon', 'pulse', 'sea', 'synth']
