import { useReducer, useCallback } from 'react'
import type { GuitarString, DetectedNote } from '../lib/tuning'

interface TunerDisplayState {
  isListening: boolean
  permissionDenied: boolean
  detectedNote: DetectedNote | null
  detectedFrequency: number | null
  cents: number
  clarity: number
  nearestString: GuitarString | null
  selectedString: GuitarString | null
  semitoneOffset: number
}

type TunerAction =
  | { type: 'START_LISTENING' }
  | { type: 'STOP_LISTENING' }
  | { type: 'PERMISSION_DENIED' }
  | { type: 'CLEAR_DETECTION' }
  | { type: 'SET_CLARITY'; clarity: number }
  | { type: 'UPDATE_DETECTION'; note: DetectedNote; frequency: number; nearest: GuitarString; cents: number }
  | { type: 'SELECT_STRING'; string: GuitarString | null }
  | { type: 'SET_SEMITONE_OFFSET'; offset: number }

const initialState: TunerDisplayState = {
  isListening: false,
  permissionDenied: false,
  detectedNote: null,
  detectedFrequency: null,
  cents: 0,
  clarity: 0,
  nearestString: null,
  selectedString: null,
  semitoneOffset: 0,
}

function tunerReducer(state: TunerDisplayState, action: TunerAction): TunerDisplayState {
  switch (action.type) {
    case 'START_LISTENING':
      return { ...state, isListening: true, permissionDenied: false }
    case 'STOP_LISTENING':
      return {
        ...state,
        isListening: false,
        detectedNote: null,
        detectedFrequency: null,
        nearestString: null,
        cents: 0,
        clarity: 0,
      }
    case 'PERMISSION_DENIED':
      return { ...state, permissionDenied: true }
    case 'CLEAR_DETECTION':
      return {
        ...state,
        detectedNote: null,
        detectedFrequency: null,
        nearestString: null,
        cents: 0,
      }
    case 'SET_CLARITY':
      return { ...state, clarity: action.clarity }
    case 'UPDATE_DETECTION':
      return {
        ...state,
        detectedNote: action.note,
        detectedFrequency: action.frequency,
        nearestString: action.nearest,
        cents: action.cents,
      }
    case 'SELECT_STRING':
      return { ...state, selectedString: action.string }
    case 'SET_SEMITONE_OFFSET':
      return { ...state, semitoneOffset: action.offset }
  }
}

interface TunerStateActions {
  startListening: () => void
  stopListening: () => void
  permissionDenied: () => void
  clearDetection: () => void
  setClarity: (clarity: number) => void
  updateDetection: (note: DetectedNote, frequency: number, nearest: GuitarString, cents: number) => void
  selectString: (s: GuitarString | null) => void
  setSemitoneOffset: (offset: number) => void
}

/**
 * Manages the tuner's display state via a reducer to keep useState count low.
 * Separates UI state management from audio processing logic in use-tuner.
 */
export function useTunerState(): [TunerDisplayState, TunerStateActions] {
  const [state, dispatch] = useReducer(tunerReducer, initialState)

  const actions: TunerStateActions = {
    startListening: useCallback(() => dispatch({ type: 'START_LISTENING' }), []),
    stopListening: useCallback(() => dispatch({ type: 'STOP_LISTENING' }), []),
    permissionDenied: useCallback(() => dispatch({ type: 'PERMISSION_DENIED' }), []),
    clearDetection: useCallback(() => dispatch({ type: 'CLEAR_DETECTION' }), []),
    setClarity: useCallback((clarity: number) => dispatch({ type: 'SET_CLARITY', clarity }), []),
    updateDetection: useCallback(
      (note: DetectedNote, frequency: number, nearest: GuitarString, cents: number) =>
        dispatch({ type: 'UPDATE_DETECTION', note, frequency, nearest, cents }),
      [],
    ),
    selectString: useCallback((s: GuitarString | null) => dispatch({ type: 'SELECT_STRING', string: s }), []),
    setSemitoneOffset: useCallback((offset: number) => dispatch({ type: 'SET_SEMITONE_OFFSET', offset }), []),
  }

  return [state, actions]
}
