/**
 * Tiny, always-visible build stamp so you can confirm at a glance which
 * deployment is running — without waiting for the boot splash to flash by. The
 * value is injected at build time (see vite.config.ts) and matches the splash
 * stamp exactly. Non-interactive and low-contrast so it stays out of the way.
 *
 * @example
 * <VersionBadge />
 */
export function VersionBadge() {
  return (
    <div
      className="pointer-events-none fixed bottom-1 left-1 z-[100] select-none font-mono text-[10px] leading-none text-smoke-100/30"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      data-testid="app-version-badge"
    >
      {__APP_VERSION__}
    </div>
  )
}
