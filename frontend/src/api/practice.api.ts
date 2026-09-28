import { api } from '../config/api'
import type {
  PracticeProgress,
  PracticeSummary,
  SavePracticeProgressPayload,
  SkillLevel,
} from '../types/practice'

export const practiceApi = {
  summary: () =>
    api.get<PracticeSummary>('/api/v1/practice/summary').then((r) => r.data),

  setLevel: (skillLevel: SkillLevel) =>
    api
      .put<{ skill_level: SkillLevel }>('/api/v1/practice/level', { skill_level: skillLevel })
      .then((r) => r.data),

  progress: (songId: string) =>
    api.get<PracticeProgress>(`/api/v1/practice/songs/${songId}`).then((r) => r.data),

  saveProgress: (songId: string, payload: SavePracticeProgressPayload) =>
    api.put<PracticeProgress>(`/api/v1/practice/songs/${songId}`, payload).then((r) => r.data),
}
