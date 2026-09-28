# Isolated capo integration checks

Run `just test-capo`. Uses installed Playwright Chromium; no browser installation occurs.
If needed, set `TEST_CHROMIUM_EXECUTABLE` to an existing test-only Chromium binary.

This recipe creates disposable HOME, XDG config/cache and temporary directories, removed on exit. Playwright owns fresh nonpersistent browser contexts and closes its browsers and fixture server after the run. No existing browser profile or real credentials are used.

`frontend/playwright.capo.config.ts` starts a dedicated loopback Vite server on port 5187, refuses to reuse a running server, blocks service workers, and runs desktop and mobile viewports. The spec uses synthetic auth and song data, mocks API responses, and blocks all non-loopback browser traffic. It never connects to production services.

Checks cover custom frets, chord and slash-bass transposition, voicing diagrams, persisted song preferences, suggested frets, and restoring no capo. `just build-frontend` checks TypeScript and production compilation; `just lint-frontend` checks lint.

# Isolated song metronome checks

Run `just test-song-metronome`. It uses the same sandboxed harness and `frontend/playwright.capo.config.ts` as `just test-capo` (disposable HOME/XDG/TMP, dedicated loopback server on port 5187, synthetic auth and song data, all non-loopback traffic blocked).

Checks cover the song-page metronome tempo coming from the beats detected in the recording, falling back to the tab tempo and meter when no beats were detected, and the Bars view showing the song's meter. The beat-following click timing is covered by `just test-frontend src/features/metronome/lib/song-beat-grid.test.ts`; building the beat grid (bars in the song's meter, double/half tempo correction, older-song fallbacks) is covered by `just test-backend-file tests/test_song_detail_beat_grid.py`.

# Isolated practice-path checks

Run `just test-practice`. It uses the same sandboxed harness and `frontend/playwright.capo.config.ts` as `just test-capo`: disposable HOME, XDG and TMP directories; a dedicated loopback server on port 5187; synthetic auth and song data; and all non-loopback traffic blocked, with the shared auth fixture aborting any third-party request.

Checks cover:

- The "Tonight's practice" home: level picker, first-song card, setlists and the setlist page.
- The Pro path on a song: Hear it plays the guitar alone, Learn it shows shape cards at 75% speed, and Play it with the band leaves the dashed "YOU" seat.
- Band-member toggles.
- The free plan: locked band members, adding songs from YouTube and steps 3–4 all open the paywall with the yearly and monthly plans.
- The trial countdown banner opening the paywall.

The path logic (step completion, shape order, verse loop) is covered by `just test-frontend src/features/practice/lib/practice-steps.test.ts`. Backend setlists, practice progress, the free tier and song retagging are covered by the backend suite (`just test-backend`).
