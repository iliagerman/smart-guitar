import { create } from 'zustand'
import { persist } from 'zustand/middleware'

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  const rounded = Math.trunc(n)
  return Math.max(min, Math.min(max, rounded))
}

/** Whether lyrics highlighting is active or disabled (auto-scroll). */
export type LyricsHighlightMode = 'highlight' | 'none'
export type LyricsSourceMode = 'auto' | 'ver1' | 'ver2' | 'ver3' | 'ver4' | 'off'
export type StrumSource = 'songsterr' | 'ai'

export interface SongOverrides {
  /** Stable key for the selected sheet source shown in the player. */
  selectedVersionKey?: string
  /** Legacy index into the simplified sheet source list shown in the player. */
  selectedVersionIndex?: number
  /** Manual lyrics source override. Undefined means: follow the automatic default. */
  selectedLyricsSource?: LyricsSourceMode
  transposeSemitones?: number
  lyricsOffsetMs?: number
  strumSource?: StrumSource
  playbackRate?: number
  chordDisplayMode?: 'standard' | 'beginner' | 'capo'
  chordCapoFret?: number
  sheetMode?: 'chords' | 'tabs'
  /** Per-stem volume levels (0–1). Key is stem name (e.g. 'vocals', 'drums'). */
  stemVolumes?: Record<string, number>
}

export interface CameraPreviewPosition {
  x: number
  y: number
}

export interface PlayerPrefsState {
  /** Display-only transpose in semitones. */
  transposeSemitones: number
  /** Show/hide strumming arrows in the chord sheet. */
  showStrums: boolean
  /** Lyrics sync offset in milliseconds. Positive = lyrics delayed (for when
   *  highlights appear too early). Negative = lyrics advanced. */
  lyricsOffsetMs: number
  /** Auto-scroll speed in pixels per second (used when lyricsMode is 'none'). */
  autoScrollSpeed: number
  /** Lyrics highlight mode: 'highlight' = show synced highlighting, 'none' = auto-scroll. */
  lyricsMode: LyricsHighlightMode
  /** Strum pattern source: 'songsterr' (tab data) or 'ai' (LLM-generated). */
  strumSource: StrumSource
  /** Automatically start recording when a song starts playing. */
  autoRecord: boolean
  /** Automatically download recordings when recording stops.
   *  When false, a download button is shown instead. */
  autoDownloadRecordings: boolean
  /** When true, recording captures video (camera + audio) as WebM instead of audio-only MP3. */
  recordVideo: boolean
  /** Position of the camera preview thumbnail (top-left corner, in px). */
  cameraPreviewPosition: CameraPreviewPosition | null
  /** Whether the camera preview is minimized to a small FAB. */
  cameraPreviewMinimized: boolean
  /** When true, the recorder mixes the backing track digitally into the output
   *  instead of relying on the mic to pick it up from speakers. Requires headphones. */
  headphonesMode: boolean
  /** Gain applied to the guitar (mic) input in the recording mix (0–5). */
  recordingGuitarGain: number
  /** Gain applied to the backing track in the recording mix (0–1). */
  recordingBackingGain: number
  /** Per-song setting overrides. Key is songId. */
  songOverrides: Record<string, SongOverrides>
  setSongOverride: <K extends keyof SongOverrides>(songId: string, key: K, value: SongOverrides[K]) => void
  clearSongOverrides: (songId: string) => void
  setTransposeSemitones: (semitones: number) => void
  transposeUp: () => void
  transposeDown: () => void
  resetTranspose: () => void
  setShowStrums: (show: boolean) => void
  toggleShowStrums: () => void
  setLyricsOffsetMs: (ms: number) => void
  setAutoScrollSpeed: (pxPerSec: number) => void
  setLyricsMode: (mode: LyricsHighlightMode) => void
  setStrumSource: (source: StrumSource) => void
  cycleStrumSource: () => void
  setAutoRecord: (enabled: boolean) => void
  setAutoDownloadRecordings: (enabled: boolean) => void
  setRecordVideo: (enabled: boolean) => void
  setCameraPreviewPosition: (pos: CameraPreviewPosition) => void
  setCameraPreviewMinimized: (minimized: boolean) => void
  setHeadphonesMode: (enabled: boolean) => void
  setRecordingGuitarGain: (gain: number) => void
  setRecordingBackingGain: (gain: number) => void
}

export const usePlayerPrefsStore = create<PlayerPrefsState>()(
  persist(
    (set, get) => ({
      transposeSemitones: 0,
      showStrums: true,
      lyricsOffsetMs: 0,
      autoScrollSpeed: 60,
      lyricsMode: 'highlight' as LyricsHighlightMode,
      strumSource: 'songsterr' as StrumSource,
      autoRecord: false,
      autoDownloadRecordings: true,
      recordVideo: false,
      cameraPreviewPosition: null,
      cameraPreviewMinimized: false,
      headphonesMode: false,
      recordingGuitarGain: 3.0,
      recordingBackingGain: 0.5,
      songOverrides: {},
      setSongOverride: (songId, key, value) =>
        set((state) => ({
          songOverrides: {
            ...state.songOverrides,
            [songId]: { ...state.songOverrides[songId], [key]: value },
          },
        })),
      clearSongOverrides: (songId) =>
        set((state) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [songId]: _removed, ...rest } = state.songOverrides
          return { songOverrides: rest }
        }),
      setTransposeSemitones: (semitones) =>
        set({ transposeSemitones: clampInt(semitones, -12, 12) }),
      transposeUp: () => {
        const next = clampInt(get().transposeSemitones + 1, -12, 12)
        set({ transposeSemitones: next })
      },
      transposeDown: () => {
        const next = clampInt(get().transposeSemitones - 1, -12, 12)
        set({ transposeSemitones: next })
      },
      resetTranspose: () => set({ transposeSemitones: 0 }),
      setShowStrums: (show) => set({ showStrums: !!show }),
      toggleShowStrums: () => set({ showStrums: !get().showStrums }),
      setLyricsOffsetMs: (ms) =>
        set({ lyricsOffsetMs: clampInt(ms, -2000, 2000) }),
      setAutoScrollSpeed: (pxPerSec) =>
        set({ autoScrollSpeed: clampInt(pxPerSec, 10, 200) }),
      setLyricsMode: (mode) => set({ lyricsMode: mode }),
      setStrumSource: (source) => set({ strumSource: source }),
      cycleStrumSource: () =>
        set({ strumSource: get().strumSource === 'songsterr' ? 'ai' : 'songsterr' }),
      setAutoRecord: (enabled) => set({ autoRecord: !!enabled }),
      setAutoDownloadRecordings: (enabled) => set({ autoDownloadRecordings: !!enabled }),
      setRecordVideo: (enabled) => set({ recordVideo: !!enabled }),
      setCameraPreviewPosition: (pos) => set({ cameraPreviewPosition: pos }),
      setCameraPreviewMinimized: (minimized) => set({ cameraPreviewMinimized: minimized }),
      setHeadphonesMode: (enabled) => set({ headphonesMode: !!enabled }),
      setRecordingGuitarGain: (gain) => set({ recordingGuitarGain: Math.max(0, Math.min(5, gain)) }),
      setRecordingBackingGain: (gain) => set({ recordingBackingGain: Math.max(0, Math.min(1, gain)) }),
    }),
    {
      name: 'player-prefs',
      migrate: (persisted: unknown) => {
        const state = persisted as Record<string, unknown>
        if (state) {
          const currentMode = state.lyricsMode as string | undefined
          if (currentMode === 'quick') {
            state.lyricsMode = 'ver1'
          } else if (currentMode === 'accurate' || currentMode === 'precise') {
            state.lyricsMode = 'ver2'
          }
        }

        if (state && !state.lyricsMode) {
          const hadHighlight = state.showHighlight !== false
          const oldVersion = state.lyricsVersion as string | undefined
          if (!hadHighlight) {
            state.lyricsMode = 'none'
          } else if (oldVersion === 'precise') {
            state.lyricsMode = 'ver2'
          } else {
            state.lyricsMode = 'ver1'
          }
          delete state.showHighlight
          delete state.lyricsVersion
        }

        // Default strumSource if not present
        if (state && !state.strumSource) {
          state.strumSource = 'songsterr'
        }

        // Default recording settings if not present (v3 → v4)
        if (state && state.autoRecord === undefined) {
          state.autoRecord = false
        }
        if (state && state.autoDownloadRecordings === undefined) {
          state.autoDownloadRecordings = true
        }

        // Default video recording setting (v4 → v5)
        if (state && state.recordVideo === undefined) {
          state.recordVideo = false
        }

        // Default camera preview settings (v5 → v6)
        if (state && state.cameraPreviewPosition === undefined) {
          state.cameraPreviewPosition = null
        }
        if (state && state.cameraPreviewMinimized === undefined) {
          state.cameraPreviewMinimized = false
        }

        // Default per-song overrides (v7 → v8)
        if (state && state.songOverrides === undefined) {
          state.songOverrides = {}
        }

        // Unified versions: migrate chordVersion + lyricsMode to selectedVersionIndex (v8 → v9)
        if (state && typeof state.songOverrides === 'object') {
          for (const overrides of Object.values(
            state.songOverrides as Record<string, Record<string, unknown>>,
          )) {
            delete overrides.chordVersion
            delete overrides.lyricsMode
          }
        }
        // Migrate global lyricsMode: old ver1/ver2/ver3/ver4 values → 'highlight'
        if (state) {
          const mode = state.lyricsMode as string | undefined
          if (mode && mode !== 'none' && mode !== 'highlight') {
            state.lyricsMode = 'highlight'
          }
        }

        // Default headphones mode + recording gain settings (v11 → v12)
        if (state && state.headphonesMode === undefined) {
          state.headphonesMode = false
        }
        if (state && state.recordingGuitarGain === undefined) {
          state.recordingGuitarGain = 3.0
        }
        if (state && state.recordingBackingGain === undefined) {
          state.recordingBackingGain = 0.5
        }

        // v12 → v13: stems are always all-on; drop global defaultStems and
        // any per-song activeStems selection. Only stemVolumes persist.
        if (state) {
          delete state.defaultStems
        }
        if (state && typeof state.songOverrides === 'object') {
          for (const overrides of Object.values(
            state.songOverrides as Record<string, Record<string, unknown>>,
          )) {
            delete overrides.activeStems
          }
        }

        return state as unknown as PlayerPrefsState
      },
      version: 14,
    }
  )
)
