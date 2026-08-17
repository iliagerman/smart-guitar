# Code Quality Assessment — guitar_player

## Test Coverage

| Area | Assets |
|---|---|
| `backend/tests/` | 45 pytest modules + `conftest.py` |
| ML services | `inference_demucs/tests/`, `chords_generator/tests/`, `lyrics_generator/tests/`, `tabs_generator/tests/` |
| `scripts/tests/` | ops tests |
| `frontend` unit | 21 co-located Vitest files (`src/**/*.test.ts`) |
| `frontend` E2E | 24 Playwright specs in `src/e2e/specs/` |

- **Frameworks**: `pytest 9.0.2` with `pytest-asyncio 1.3.0` in
  `asyncio_mode = "auto"`, `pytest-timeout`, `aiosqlite` (in-memory DB),
  `moto[s3] 5.1.21` in the ML services; `vitest 4.0.18` (`environment: 'node'`,
  `include: ['src/**/*.test.ts']`); `@playwright/test 1.58.2` (chromium only,
  `baseURL http://localhost:5173`, auto-starts `npm run dev`).
- **Coverage config: absent.** No `--cov`, no `coverage` dependency, no
  `@vitest/coverage-*`, no threshold anywhere. `docs/test-coverage-gap-analysis.md`
  is the manual substitute.
- **Structural gap**: Vitest's `include` pattern excludes `.tsx`, so
  component/RTL tests cannot run at all. Zero frontend integration (RTL) tests
  exist despite the ambient mandate for them.
- **Verified green during the scan (dirty tree)**:
  `npx vitest run strum-pattern.test.ts lyrics-sources.test.ts` → 18/18 passed ·
  `uv run --frozen pytest tests/test_sheet_preamble.py tests/test_processing_lock.py -q`
  → 24 passed (1 SAWarning on `drop_all` from the `jobs ↔ songs` FK cycle) ·
  `npx tsc -b` → exit 0, zero errors.
- **Doc contradiction**: `AGENTS.md` says "Never generate unit tests. This project
  does not use unit tests." — but 21 Vitest files and most of `backend/tests/`
  are unit tests.

## Linting, Typing, CI/CD

- **Python**: `ruff 0.15.2` is a dev dependency but there is **no `[tool.ruff]`
  config block anywhere** (defaults only) and **no `just lint-backend` recipe**.
- **TypeScript**: ESLint 9 flat config at `frontend/eslint.config.js`
  (js.recommended + typescript-eslint.recommended + react-hooks + react-refresh,
  `globalIgnores(['dist'])`), reachable via `just lint-frontend`.
- **Inert suppressions**: source carries `// oxlint-disable-next-line …` pragmas
  (in `StrumPatternCard.tsx`, `ProcessButton.tsx`) but `oxlint` is in neither
  `package.json` nor the justfile — the suppressions never fire.
- **Type checking**: `pyrightconfig.json` (3 execution environments) for Python;
  `tsc -b` for TypeScript, wired into `npm run build` so type errors block the
  frontend deploy.
- **CI/CD: none.** No `.github/`, no `.gitlab-ci.yml`, no CodePipeline/CodeBuild
  in `infra/`. Every gate is manual and local; deployment is hand-run bash under
  `scripts/deploy/` driven by `just deploy-*`.

## Documentation Quality

Strong for a solo project: root `ARCHITECTURE.md` (schema, flows, routes, stores,
services, 10 design decisions, 3 generated PNG diagrams via
`docs/diagrams/generate_diagrams.py`), `AGENTS.md` (explicit stack / pattern /
command rules), `backend/API.md`, per-ML-service `API.md`,
`chords_generator/README.md`, `frontend/README.md`,
`docs/test-coverage-gap-analysis.md`, planning docs. Inline comments carry real
*why* rationale. **Zero** `TODO`/`FIXME`/`HACK`/`XXX` markers across
`backend/src` + `frontend/src`.

**Drift**: `wavesurfer.js` documented but absent; `AGENTS.md` forbids the full
Amplify SDK while `aws-amplify 6.16.2` is installed; neither doc mentions
`self-heal`, the mute controls, the `analytics` router (10 endpoints), or the S3
job-status-manifest channel.

## Source Divergence — Root Cause (the reconciliation core)

**Root cause: Syncthing syncs file content between the Mac and the homeserver
while `.stignore` explicitly excludes `.git`** ("Syncthing scrambles .git across
live checkouts). File content therefore crosses machines and git history never
does. `.gitignore` line 20 additionally excludes `.claude/`, so the AI-DLC
framework itself is untracked here. `.stfolder/` confirms this tree is a live
Syncthing folder.

**Current dirty blend**: Mac HEAD = `fff6aad` (2026-07-11 09:14 +0300), while
homeserver HEAD = `0c38c5b` on a separate history rooted at common ancestor
`64e4da4`. The shared working tree carries **24 modified tracked files + 8
untracked paths (`+265/−114`)**. File mtimes are not reliable authorship or
deployment evidence because Syncthing preserves them.

| Change group | Files | Current production evidence |
|---|---|---|
| Sheet/strum fixes | `sheet_alignment.py`, `test_sheet_preamble.py`, `strum-pattern.ts`, `StrumPatternCard.tsx`, `use-strum-playback.ts` | Present in homeserver snapshot `9b3faa4`; strum direction remains a product decision |
| Mobile/source/deploy fixes | `SheetSelector.tsx`, `lyrics-sources.ts`, `scripts/deploy/_lib.sh` | Present in homeserver snapshot `9b3faa4` |
| Refresh/observability | `JobWatcher.tsx`, `runtime-observer.ts`, `runtime-observer.d.ts` | Frontend bundle contains `instrumentConsole`; frontend tag `0c38c5b` includes the changes |
| Mute and explicit self-heal | `TrackSelector.tsx`, `songs.py`, `songs.api.ts`, `SongDetailPage/index.tsx` | **Not deployed**: live bundle and `0c38c5b` contain none of the distinguishing strings |
| Song-create race | `song_dao.py`, `song_service/core.py` | **Not deployed**: backend API tag remains `32bde3f` |
| Processing completion | sweeper Dockerfile, `stem_processing.py`, `ProcessButton.tsx` | Deployed per component: sweeper `82eae22`; orchestrator/frontend `0c38c5b` |

**Deployment provenance is unsafe, not absent**: deploy scripts build from the
current working tree and only afterward tag `HEAD`; they do not require a clean
tree. A dirty deploy can therefore produce an artifact not represented by its
tag. Current homeserver-local component tags plausibly match the distinguishing
production evidence (`frontend` and `job_orchestrator` at `0c38c5b`, backend API
at `32bde3f`, stale sweeper at `82eae22`), but those commits and tags were never
pushed to GitHub or fetched into the Mac clone before this investigation.

**Destructive-operation warning**: stem mute controls (`git log -S'Mute all'
-- frontend/src` → empty) and `self-heal` (`git log -S'self-heal' -- backend/src`
→ empty) have no committed ancestor. A `checkout`, `reset`, or `clean` can lose
them unless they are committed or backed up. This session preserved the dirty
state at `/tmp/guitar-player-before-reconcile-20260816-230659`.

**Unresolved product decision**: commit `95d6c77` introduced
`normalizedGridDirection()` (down-on-count / up-on-offbeat, all-down for ≤4
steps). The W1 working tree **deletes** that function, renders stored directions
verbatim, and **rewrites the tests to assert the opposite** (5 grid-lock
assertions → 2 preserve-stored-directions assertions). Both suites pass against
their own implementation, so tests cannot arbitrate — this is a product call, not
a merge.

## Technical Debt Register

1. No CI; nothing enforces lint / typecheck / tests before a deploy.
2. Org `## Way of Working` mandates trunk-based development with short-lived
   branches; actual practice is one long-lived dirty tree with a 36-day
   uncommitted backlog synced between two machines.
3. Dead code: `_run_background_healing` remains in `routers/songs.py` and is now
   called by nothing.
4. `use-strum-playback.ts` became an unbounded rolling 250 ms-lookahead scheduler
   with no stop condition and no test file — correctness depends entirely on
   `stop()` being called.
5. `ProcessButton`'s state machine juggles three progress sources (`job`,
   `manifest`, `coreReady`); the `dismissed`/`shouldDismiss` reshuffle fixed a
   real ordering bug and signals over-complexity.
6. Oversized modules — see `code-structure.md`; the `justfile` is a 61 KB /
   100-recipe monolith.
7. Unpinned `runtime-observer` git ref shared by 5 packages; `curl-cffi >=0.15.0`
   conflicts with `lyrics_generator`'s `==0.14.0`; version drift across 5
   independently locked Python services.
8. `jobs ↔ songs` circular FK; 28 Alembic revisions with hand-authored
   non-monotonic ids.
9. Repo hygiene: `frontend/.env.production` and
   `frontend/playwright-report/index.html` are tracked; `frontend/test-results/`
   churns on every run; `infra/terraform.tfstate` + `.backup` sit in the tree;
   large binaries and generated ops state (`smart-guitar-brand-book.zip` 16 MB,
   `regen_state.jsonl` 229 KB, `regen_refresh.jsonl` 211 KB,
   `unrecoverable_songs.log` 40 KB) live at the root; a stray
   `client_secret_*.apps.googleusercontent.com.json` is on disk (gitignored).
10. Terraform state is local, not remote-backed.

## Positive Signals

- Every uncommitted wave carries clear self-documenting rationale, and several
  fix real production defects: BuildKit provenance rejection by Lambda, an
  over-permissive YouTube-ID matcher, a concurrent-create `IntegrityError` race,
  job progress stuck below 100, missing `ffmpeg` in the sweeper image, per-load
  healing cost, and stale-closure clobbering in the "Mute all" batch write.
- The blended working tree **typechecks clean and passes the tests exercised**.
  Reconciliation is a history and provenance problem, not a broken-code problem.
