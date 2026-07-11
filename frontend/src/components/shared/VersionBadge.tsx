/**
 * Inline build stamp for the Settings screen so you can confirm which
 * deployment is running without waiting for the boot splash. The value is
 * injected at build time (see vite.config.ts) and matches the splash stamp
 * exactly.
 *
 * @example
 * <VersionBadge />
 */
export function VersionBadge() {
  return (
    <p
      className="mt-6 text-center font-mono text-[11px] text-smoke-500"
      data-testid="app-version-badge"
    >
      {__APP_VERSION__}
    </p>
  )
}
