/**
 * Assembles the one-line build stamp shown on the boot splash so a tester can
 * confirm which deployment is actually running (a stale PWA cache shows an old
 * stamp). The pieces are computed at build time in vite.config.ts:
 *
 * - `build`   monorepo commit count (`git rev-list --count HEAD`) — auto-
 *             increments on every commit to any component, not just the UI.
 * - `commit`  short commit hash, to pin the exact source.
 * - `buildTime` local wall-clock time the bundle was built.
 */
export function formatBuildStamp(build: number, commit: string, buildTime: string): string {
  return `v${build} · ${commit} · ${buildTime}`
}
