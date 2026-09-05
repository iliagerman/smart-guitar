import { test, expect } from '../fixtures/auth'

test.describe('Metronome', () => {
  test('controls tempo, meter, sound, and click volume', async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('metronome-practice-storage-cleared')) {
        localStorage.removeItem('strumming-exercises-v1')
        sessionStorage.setItem('metronome-practice-storage-cleared', 'true')
      }
      const tickFrequencies: number[] = []
      const wakeLockRequests: number[] = []
      Object.defineProperty(window, '__metronomeTickFrequencies', { value: tickFrequencies })
      Object.defineProperty(window, '__screenWakeLockRequests', { value: wakeLockRequests })
      Object.defineProperty(navigator, 'wakeLock', {
        value: {
          request: async () => {
            wakeLockRequests.push(1)
            let released = false
            return {
              get released() { return released },
              release: async () => { released = true },
              addEventListener: () => undefined,
            }
          },
        },
      })
      class MockAudioContext {
        currentTime = 0
        destination = {}
        state = 'running'
        createOscillator() {
          const oscillator = {
            type: 'sine',
            frequency: { value: 0 },
            connect: <T>(node: T) => node,
            start: () => tickFrequencies.push(oscillator.frequency.value),
            stop: () => undefined,
          }
          return oscillator
        }
        createGain() {
          return {
            gain: {
              setValueAtTime: () => undefined,
              exponentialRampToValueAtTime: () => undefined,
            },
            connect: <T>(node: T) => node,
          }
        }
        resume() { return Promise.resolve() }
      }
      Object.defineProperty(window, 'AudioContext', { value: MockAudioContext })
    })
    await page.goto('/metronome')

    await expect(page.getByTestId('metronome-page')).toBeVisible()
    await expect(page.getByTestId('metronome-bpm')).toHaveText('120')
    await expect(page.getByTestId('metronome-sound-toggle')).toContainText('Sound on')
    await expect(page.getByTestId('metronome-volume')).toHaveValue('70')
    await expect(page.getByTestId('strumming-practice')).toBeVisible()
    await expect(page.locator('[data-testid^="strum-step-"]')).toHaveCount(8)
    await expect(page.getByTestId('strum-step-0')).toContainText('↓')
    await expect(page.getByTestId('strum-step-1')).toContainText('↑')
    await expect(page.getByTestId('strumming-practice').locator('[data-metronome-tick="true"]')).toHaveCount(4)
    await expect(page.getByTestId('strumming-exercise-select').locator('option')).toHaveCount(9)
    await expect(page.getByTestId('strum-step-0')).toHaveAttribute('data-strum-action', 'accent')
    await expect(page.getByTestId('strum-step-0')).toHaveClass(/border-sky-400/)

    await page.getByTestId('strumming-exercise-select').selectOption('pop-d-d-u-u-d-u')
    await expect(page.getByTestId('strumming-exercise-name')).toHaveText('Common pop: D D U U D U')
    await expect(page.getByTestId('strum-step-1')).toContainText('Skip')

    await page.getByTestId('invent-strumming-pattern').click()
    await expect(page.getByTestId('custom-exercise-name')).toHaveValue('Fresh pattern')
    await expect(page.getByTestId('custom-strum-play-0')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('custom-strum-accent-0')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('custom-strum-accent-0').click()
    await expect(page.getByTestId('custom-strum-accent-0')).toHaveAttribute('aria-pressed', 'false')
    await page.getByTestId('custom-strum-play-0').click()
    await expect(page.getByTestId('custom-strum-play-0')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('custom-strum-accent-0')).toBeDisabled()
    await page.getByTestId('close-strumming-composer').click()

    await page.getByTestId('compose-strumming-pattern').click()
    await page.getByTestId('custom-exercise-name').fill('My syncopation')
    await page.getByTestId('custom-exercise-tempo').fill('96')
    await page.getByTestId('custom-strum-play-1').click()
    await page.getByTestId('custom-strum-accent-1').click()
    await expect(page.getByTestId('custom-strum-accent-1')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('save-strumming-exercise').click()
    await expect(page.getByTestId('strumming-exercise-name')).toHaveText('My syncopation')
    await expect(page.getByTestId('strumming-exercise-tempo')).toHaveText('Practice at 96 BPM')
    await expect(page.getByTestId('metronome-bpm')).toHaveText('96')
    await page.reload()
    await page.getByTestId('strumming-exercise-select').selectOption({ label: 'My syncopation' })
    await expect(page.getByTestId('metronome-bpm')).toHaveText('96')

    await page.getByTestId('metronome-tempo-increase').click()
    await expect(page.getByTestId('metronome-bpm')).toHaveText('97')
    await expect(page.getByTestId('metronome-source')).toHaveText('Manual tempo')

    await page.getByTestId('metronome-beats-per-bar').selectOption('3')
    await page.getByTestId('metronome-beat-unit').selectOption('8')
    await expect(page.getByTestId('metronome-signature')).toHaveText('3/8')
    await expect(page.locator('[data-testid^="metronome-beat-"][data-accented]')).toHaveCount(3)
    await expect(page.getByTestId('metronome-beat-0')).toHaveAttribute('data-accented', 'true')

    await page.getByTestId('metronome-volume').fill('35')
    await expect(page.getByTestId('metronome-volume-value')).toHaveText('35%')

    await page.getByTestId('metronome-sound-toggle').click()
    await expect(page.getByTestId('metronome-sound-toggle')).toContainText('Sound off')
    await page.getByTestId('metronome-sound-toggle').click()
    await expect(page.getByTestId('metronome-sound-toggle')).toContainText('Sound on')

    await page.getByTestId('metronome-toggle-button').click()
    await expect(page.getByTestId('metronome-toggle-button')).toHaveText('Stop')
    await expect(page.getByTestId('screen-wake-lock-status')).toContainText('Screen will stay awake')
    await expect.poll(() => page.evaluate(() => (
      window as unknown as { __screenWakeLockRequests: number[] }
    ).__screenWakeLockRequests.length)).toBe(1)
    await expect.poll(() => page.evaluate(() => (
      window as unknown as { __metronomeTickFrequencies: number[] }
    ).__metronomeTickFrequencies)).toEqual(expect.arrayContaining([1500, 850]))
  })
})
