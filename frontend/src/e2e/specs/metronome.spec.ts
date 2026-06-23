import { test, expect } from '../fixtures/auth'

test.describe('Metronome', () => {
  test('standalone metronome allows manual tempo and sound control', async ({ authenticatedPage: page }) => {
    await page.goto('/metronome')

    await expect(page.getByTestId('metronome-page')).toBeVisible()
    await expect(page.getByTestId('metronome-bpm')).toHaveText('120')

    await page.getByTestId('metronome-tempo-increase').click()
    await expect(page.getByTestId('metronome-bpm')).toHaveText('121')
    await expect(page.getByTestId('metronome-source')).toHaveText('Manual tempo')

    await page.getByTestId('metronome-sound-toggle').click()
    await expect(page.getByTestId('metronome-sound-toggle')).toContainText('Sound on')

    await page.getByTestId('metronome-toggle-button').click()
    await expect(page.getByTestId('metronome-toggle-button')).toHaveText('Stop')
  })
})
