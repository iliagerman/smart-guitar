import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { practiceApi } from '@/api/practice.api'
import { queryKeys } from '@/api/query-keys'
import { analyticsTracker } from '@/lib/event-tracker'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { usePaywallStore } from '@/stores/paywall.store'
import type { PracticeProgress, PracticeStep } from '@/types/practice'
import type { LyricsSegment, SongDetail } from '@/types/song'
import {
  STAGE_DONE_FRACTION,
  completeStep,
  emptyProgress,
  firstVerseLoop,
  stepInfo,
  toggleLearnedChord,
} from '../lib/practice-steps'

/** Seconds of listening in "Hear it" before the step counts as done. */
const HEAR_IT_SECONDS = 40
const LEARN_RATE = 0.75

interface UsePracticePathArgs {
  songId: string
  detail: SongDetail
  songTitle: string
  lyrics: LyricsSegment[]
  shapes: string[]
  isPro: boolean
  onSetStemVolumes: (volumes: Record<string, number>) => void
  onSeek: (time: number) => void
}

function setRate(songId: string, rate: number) {
  usePlaybackStore.getState().setPlaybackRate(rate)
  usePlayerPrefsStore.getState().setSongOverride(songId, 'playbackRate', rate)
}

function trackStep(eventType: string, songId: string, step: PracticeStep) {
  analyticsTracker.track({
    event_type: eventType,
    event_category: 'practice',
    song_id: songId,
    properties: { step },
  })
}

/**
 * The song's 4-step practice path. Each step is a preset on the existing player
 * (who's playing, speed, easy shapes, verse loop); progress is saved per song
 * so the home screen can pick it up, and steps 3–4 need Pro.
 */
export function usePracticePath({
  songId,
  detail,
  songTitle,
  lyrics,
  shapes,
  isPro,
  onSetStemVolumes,
  onSeek,
}: UsePracticePathArgs) {
  const queryClient = useQueryClient()
  const openPaywall = usePaywallStore((s) => s.openPaywall)
  const [activeStep, setActiveStep] = useState<PracticeStep | null>(null)
  const [stageFraction, setStageFraction] = useState(0)
  const { data } = useQuery({
    queryKey: queryKeys.practice.progress(songId),
    queryFn: () => practiceApi.progress(songId),
  })
  const progress = data ?? emptyProgress(songId)
  // Callbacks read the cache, not the render value: finishing a step and starting
  // the next one happen in one tick and must build on each other.
  const latest = useCallback(
    () => queryClient.getQueryData<PracticeProgress>(queryKeys.practice.progress(songId)) ?? emptyProgress(songId),
    [queryClient, songId],
  )

  const save = useMutation({
    mutationFn: (next: PracticeProgress) =>
      practiceApi.saveProgress(songId, {
        current_step: next.current_step,
        completed_steps: next.completed_steps,
        learned_chords: next.learned_chords,
        stage_progress: next.stage_progress,
      }),
    // The local copy stays the source of truth while practicing; the server echo
    // could land out of order after several quick saves.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.practice.summary() })
    },
  })

  const commit = useCallback(
    (next: PracticeProgress) => {
      queryClient.setQueryData(queryKeys.practice.progress(songId), next)
      save.mutate(next)
    },
    [queryClient, save, songId],
  )

  const bandVolumes = useCallback(
    (guitar: number, others: number) =>
      Object.fromEntries(
        detail.stem_types.flatMap(({ name }) =>
          detail.stems[name] ? [[name, name === 'guitar' ? guitar : others]] : [],
        ),
      ),
    [detail],
  )

  const applyGuitarOnly = useCallback(() => {
    if (detail.stems_locked) {
      usePlaybackStore.getState().setActiveStems(['guitar'])
      return
    }
    onSetStemVolumes(bandVolumes(1, 0))
  }, [bandVolumes, detail.stems_locked, onSetStemVolumes])

  const applyEasyShapes = useCallback(() => {
    const capo = detail.song.easy_capo ?? 0
    const mode = capo > 0 ? 'capo' : 'beginner'
    usePlaybackStore.getState().setChordDisplayMode(mode, capo)
    const prefs = usePlayerPrefsStore.getState()
    prefs.setSongOverride(songId, 'chordDisplayMode', mode)
    prefs.setSongOverride(songId, 'chordCapoFret', capo)
  }, [detail.song.easy_capo, songId])

  const goToStep = useCallback(
    (step: PracticeStep) => {
      const current = latest()
      if (stepInfo(step).pro && !isPro) {
        openPaywall('stage', {
          title: songTitle,
          learnedChords: current.learned_chords.length,
          completedSteps: current.completed_steps.length,
        })
        return
      }
      const playback = usePlaybackStore.getState()
      if (step <= 2) {
        applyGuitarOnly()
        setRate(songId, step === 1 ? 1 : LEARN_RATE)
      } else {
        onSetStemVolumes(bandVolumes(0, 1))
        setRate(songId, step === 3 ? LEARN_RATE : 1)
      }
      if (step === 2) {
        applyEasyShapes()
        const verse = firstVerseLoop(lyrics)
        if (verse) {
          playback.setLoop(verse.start, verse.end)
          onSeek(verse.start)
        }
      } else {
        playback.clearLoop()
      }
      if (step >= 3) onSeek(0)
      setActiveStep(step)
      setStageFraction(0)
      trackStep('practice_step_started', songId, step)
      if (current.current_step !== step) commit({ ...current, current_step: step })
    },
    [applyEasyShapes, applyGuitarOnly, bandVolumes, commit, isPro, latest, lyrics, onSeek, onSetStemVolumes, openPaywall, songId, songTitle],
  )

  const markDone = useCallback(
    (step: PracticeStep, extra?: Partial<PracticeProgress>) => {
      const current = latest()
      if (current.completed_steps.includes(step) && !extra) return
      trackStep('practice_step_completed', songId, step)
      commit({ ...completeStep(current, step), ...extra })
    },
    [commit, latest, songId],
  )

  /** Finishes the step and moves on to the next one (or leaves the path at the end). */
  const finishStep = useCallback(
    (step: PracticeStep) => {
      markDone(step)
      if (step < 4) goToStep((step + 1) as PracticeStep)
      else setActiveStep(null)
    },
    [goToStep, markDone],
  )

  /** Back to free play: the whole band at full speed, no loop. */
  const leavePath = useCallback(() => {
    setActiveStep(null)
    usePlaybackStore.getState().clearLoop()
    setRate(songId, 1)
    if (detail.stems_locked) usePlaybackStore.getState().selectFullSong()
    else onSetStemVolumes(bandVolumes(1, 1))
  }, [bandVolumes, detail.stems_locked, onSetStemVolumes, songId])

  const toggleShape = useCallback(
    (chord: string) => commit(toggleLearnedChord(latest(), chord, shapes)),
    [commit, latest, shapes],
  )

  // Step 1 is done after listening for a while; steps 3–4 after playing the song
  // through. Reads the store imperatively so ticks don't re-render the page.
  const markDoneRef = useRef(markDone)
  const commitRef = useRef(commit)
  const latestRef = useRef(latest)
  useEffect(() => {
    markDoneRef.current = markDone
    commitRef.current = commit
    latestRef.current = latest
  })

  useEffect(() => {
    if (activeStep === null || activeStep === 2) return
    let listened = 0
    let done = false
    let savedFraction = activeStep === 3 ? latestRef.current().stage_progress : 0
    let best = savedFraction
    return usePlaybackStore.subscribe((state, prev) => {
      if (done || !state.isPlaying || state.duration <= 0) return
      if (activeStep === 1) {
        listened += Math.max(0, Math.min(1, state.currentTime - prev.currentTime))
        if (listened >= HEAR_IT_SECONDS) {
          done = true
          markDoneRef.current(1)
        }
        return
      }
      const fraction = state.currentTime / state.duration
      if (fraction <= best + 0.01) return
      best = fraction
      setStageFraction(fraction)
      if (fraction >= STAGE_DONE_FRACTION) {
        done = true
        markDoneRef.current(activeStep, activeStep === 3 ? { stage_progress: 1 } : undefined)
        return
      }
      if (activeStep === 3 && fraction - savedFraction >= 0.1) {
        savedFraction = fraction
        commitRef.current({ ...latestRef.current(), stage_progress: fraction })
      }
    })
  }, [activeStep])

  return {
    progress,
    activeStep,
    stageFraction: activeStep === 3 ? Math.max(stageFraction, progress.stage_progress) : stageFraction,
    goToStep,
    finishStep,
    leavePath,
    toggleShape,
  }
}
