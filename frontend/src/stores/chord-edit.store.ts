import { create } from 'zustand'
import type { ChordEntry, LyricsSegment } from '@/types/song'

interface ChordEditState {
  isEditMode: boolean
  editingChords: ChordEntry[]
  editingLyrics: LyricsSegment[] | null
  selectedChordIndex: number | null
  dirty: boolean
  versionName: string

  enterEditMode: (chords: ChordEntry[], lyrics: LyricsSegment[]) => void
  exitEditMode: () => void

  updateChordLabel: (index: number, chord: string) => void
  updateChordTime: (index: number, startTime: number) => void
  deleteChord: (index: number) => void
  addChordAtTime: (chord: string, startTime: number) => void
  selectChord: (index: number | null) => void
  moveChordToTime: (index: number, newStartTime: number) => void

  updateWordText: (segmentIndex: number, wordIndex: number, newText: string) => void

  setVersionName: (name: string) => void
  reset: () => void
}

function rechainEndTimes(chords: ChordEntry[]): ChordEntry[] {
  if (chords.length === 0) return chords
  return chords.map((c, i) => ({
    ...c,
    end_time: i < chords.length - 1 ? chords[i + 1].start_time : c.end_time,
  }))
}

function sortByStartTime(chords: ChordEntry[]): ChordEntry[] {
  return [...chords].sort((a, b) => a.start_time - b.start_time)
}

export const useChordEditStore = create<ChordEditState>((set) => ({
  isEditMode: false,
  editingChords: [],
  editingLyrics: null,
  selectedChordIndex: null,
  dirty: false,
  versionName: 'Custom',

  enterEditMode: (chords, lyrics) =>
    set({
      isEditMode: true,
      editingChords: chords.map((c) => ({ ...c })),
      editingLyrics: JSON.parse(JSON.stringify(lyrics)),
      selectedChordIndex: null,
      dirty: false,
      versionName: 'Custom',
    }),

  exitEditMode: () =>
    set({
      isEditMode: false,
      editingChords: [],
      editingLyrics: null,
      selectedChordIndex: null,
      dirty: false,
    }),

  updateChordLabel: (index, chord) =>
    set((state) => {
      const updated = [...state.editingChords]
      if (!updated[index]) return state
      updated[index] = { ...updated[index], chord }
      return { editingChords: updated, dirty: true }
    }),

  updateChordTime: (index, startTime) =>
    set((state) => {
      const updated = [...state.editingChords]
      if (!updated[index]) return state
      updated[index] = { ...updated[index], start_time: startTime }
      const sorted = sortByStartTime(updated)
      return {
        editingChords: rechainEndTimes(sorted),
        dirty: true,
        selectedChordIndex: sorted.findIndex(
          (c) => c.start_time === startTime && c.chord === updated[index].chord
        ),
      }
    }),

  deleteChord: (index) =>
    set((state) => {
      const updated = state.editingChords.filter((_, i) => i !== index)
      return {
        editingChords: rechainEndTimes(updated),
        selectedChordIndex: null,
        dirty: true,
      }
    }),

  addChordAtTime: (chord, startTime) =>
    set((state) => {
      const lastChord = state.editingChords[state.editingChords.length - 1]
      const newChord: ChordEntry = {
        chord,
        start_time: startTime,
        end_time: lastChord ? lastChord.end_time : startTime + 2,
      }
      const updated = sortByStartTime([...state.editingChords, newChord])
      const rechained = rechainEndTimes(updated)
      const newIndex = rechained.findIndex((c) => c.start_time === startTime && c.chord === chord)
      return {
        editingChords: rechained,
        selectedChordIndex: newIndex,
        dirty: true,
      }
    }),

  selectChord: (index) => set({ selectedChordIndex: index }),

  moveChordToTime: (index, newStartTime) =>
    set((state) => {
      const updated = [...state.editingChords]
      if (!updated[index]) return state
      const movedChord = { ...updated[index], start_time: newStartTime }
      updated[index] = movedChord
      const sorted = sortByStartTime(updated)
      return {
        editingChords: rechainEndTimes(sorted),
        dirty: true,
        selectedChordIndex: sorted.indexOf(movedChord),
      }
    }),

  updateWordText: (segmentIndex, wordIndex, newText) =>
    set((state) => {
      if (!state.editingLyrics) return state
      const lyrics = JSON.parse(JSON.stringify(state.editingLyrics)) as LyricsSegment[]
      const segment = lyrics[segmentIndex]
      if (!segment?.words[wordIndex]) return state
      segment.words[wordIndex].word = newText
      segment.text = segment.words.map((w) => w.word).join(' ')
      return { editingLyrics: lyrics, dirty: true }
    }),

  setVersionName: (name) => set({ versionName: name }),

  reset: () =>
    set({
      isEditMode: false,
      editingChords: [],
      editingLyrics: null,
      selectedChordIndex: null,
      dirty: false,
      versionName: 'Custom',
    }),
}))
