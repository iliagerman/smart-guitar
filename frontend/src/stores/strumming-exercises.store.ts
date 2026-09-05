import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { StrummingExercise } from '@/features/metronome/lib/strumming-exercises'

interface StrummingExercisesState {
  customExercises: StrummingExercise[]
  addExercise: (exercise: StrummingExercise) => void
  removeExercise: (id: string) => void
}

export const useStrummingExercisesStore = create<StrummingExercisesState>()(
  persist(
    (set) => ({
      customExercises: [],
      addExercise: (exercise) => set((state) => ({ customExercises: [...state.customExercises, exercise] })),
      removeExercise: (id) => set((state) => ({
        customExercises: state.customExercises.filter((exercise) => exercise.id !== id),
      })),
    }),
    { name: 'strumming-exercises-v1' },
  ),
)
