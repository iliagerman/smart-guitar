import { describe, it, expect } from 'vitest'
import { useTrialBannerStore } from './trial-banner.store'

describe('trial-banner.store', () => {
  it('starts un-dismissed', () => {
    expect(useTrialBannerStore.getState().dismissed).toBe(false)
  })

  it('marks the banner dismissed for the session', () => {
    useTrialBannerStore.getState().dismiss()
    expect(useTrialBannerStore.getState().dismissed).toBe(true)
  })
})
