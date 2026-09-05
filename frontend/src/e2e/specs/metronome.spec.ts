import { test, expect } from '../fixtures/auth'

test.describe('Metronome', () => {
  test('controls tempo, meter, sound, and click volume', async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => {
      const tickFrequencies: number[] = []
      Object.defineProperty(window, '__metronomeTickFrequencies', { value: tickFrequencies })
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

    await page.getByTestId('metronome-tempo-increase').click()
    await expect(page.getByTestId('metronome-bpm')).toHaveText('121')
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
    await expect.poll(() => page.evaluate(() => (
      window as unknown as { __metronomeTickFrequencies: number[] }
    ).__metronomeTickFrequencies)).toEqual(expect.arrayContaining([1500, 850]))
  })
})
