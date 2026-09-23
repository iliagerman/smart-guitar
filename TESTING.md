# Isolated capo integration checks

Run `just test-capo`. Uses installed Playwright Chromium; no browser installation occurs.
If needed, set `TEST_CHROMIUM_EXECUTABLE` to an existing test-only Chromium binary.

This recipe creates disposable HOME, XDG config/cache and temporary directories, removed on exit. Playwright owns fresh nonpersistent browser contexts and closes its browsers and fixture server after the run. No existing browser profile or real credentials are used.

`frontend/playwright.capo.config.ts` starts a dedicated loopback Vite server on port 5187, refuses to reuse a running server, blocks service workers, and runs desktop and mobile viewports. The spec uses synthetic auth and song data, mocks API responses, and blocks all non-loopback browser traffic. It never connects to production services.

Checks cover custom frets, chord and slash-bass transposition, voicing diagrams, persisted song preferences, suggested frets, and restoring no capo. `just build-frontend` checks TypeScript and production compilation; `just lint-frontend` checks lint.
