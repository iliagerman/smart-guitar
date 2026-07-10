import { describe, it, expect } from 'vitest'
import { formatBuildStamp } from './build-stamp'

describe('formatBuildStamp', () => {
  it('assembles the version number, commit hash, and build time', () => {
    expect(formatBuildStamp(1247, '096d537', '2026-07-10 08:20')).toBe(
      'v1247 · 096d537 · 2026-07-10 08:20',
    )
  })

  it('renders whatever fallback values it is given (no git available)', () => {
    expect(formatBuildStamp(0, 'dev', 'unknown')).toBe('v0 · dev · unknown')
  })
})
