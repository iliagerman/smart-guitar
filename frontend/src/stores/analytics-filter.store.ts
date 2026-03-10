import { create } from 'zustand'

export type AnalyticsPreset = '7d' | '30d' | '90d' | 'custom'

interface AnalyticsFilterState {
    preset: AnalyticsPreset
    startDate: string
    endDate: string
    userEmail: string
    setPreset: (preset: Exclude<AnalyticsPreset, 'custom'>) => void
    setCustomRange: (startDate: string, endDate: string) => void
    setUserEmail: (userEmail: string) => void
}

function formatDate(value: Date): string {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function presetRange(days: number): { startDate: string; endDate: string } {
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - (days - 1))
    return {
        startDate: formatDate(start),
        endDate: formatDate(end),
    }
}

const initialRange = presetRange(30)

export const useAnalyticsFilterStore = create<AnalyticsFilterState>()((set) => ({
    preset: '30d',
    startDate: initialRange.startDate,
    endDate: initialRange.endDate,
    userEmail: '',
    setPreset: (preset) => {
        const days = preset === '7d' ? 7 : preset === '90d' ? 90 : 30
        const range = presetRange(days)
        set({ preset, ...range })
    },
    setCustomRange: (startDate, endDate) => set({ preset: 'custom', startDate, endDate }),
    setUserEmail: (userEmail) => set({ userEmail }),
}))
