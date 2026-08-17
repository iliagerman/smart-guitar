# Code Structure — guitar_player

## Repository Layout

```
guitar_player/
├── backend/              FastAPI REST API + 4 container-Lambda workers
├── frontend/             React 19 + TypeScript SPA (Vite, PWA)
├── inference_demucs/     ML service :8000 — Demucs 4 source separation
├── chords_generator/     ML service :8001 — Autochord/PyChord recognition
├── lyrics_generator/     ML service :8003 — WhisperX + Genius alignment
├── tabs_generator/       ML service :8004 — basic-pitch/librosa tabs
├── homeserver/           On-prem YouTube downloader sidecar (2 files)
├── infra/                Terraform — 8 modules
├── scripts/              Ops automation + scripts/deploy/*.sh
├── grafana/              Loki, Promtail, provisioning
├── homepage/             Static marketing site
├── docs/                 Architecture diagrams + gap analysis
├── justfile              100 recipes — the single command surface
├── pyproject.toml        Root `scripts` package
└── pyrightconfig.json    3 execution environments
```

## Backend Module Organisation

`backend/src/guitar_player/`:

| Path | Role |
|---|---|
| `main.py` | Router wiring, middleware; also exports a Mangum handler that is a compatibility / dead deployment path — production runs the ASGI app as an ECS Fargate container behind a public ALB |
| `routers/` | 9 routers, 58 route decorators — thin HTTP layer |
| `services/` | ~30 modules; business logic. Packages: `song_service/` (`core.py`, `detail.py`, `sheet_alignment.py`), `job_service/` (`core.py`, `stem_processing.py`) |
| `dao/` | `BaseDAO[T]` generic CRUD + domain DAOs (`song_dao.py`, …) |
| `models/`, `schemas/` | SQLAlchemy models and Pydantic schemas |
| `lambdas/` | `job_orchestrator`, `stale_job_sweeper`, `unconfirmed_user_cleanup`, `vocals_guitar_stitch`, `runtime.py` |
| `auth/`, `config.py`, `middleware.py`, `observability.py`, `storage.py`, `job_status_manifest.py`, `utils/` | Cross-cutting |
| `alembic/versions/` | 28 revisions, hand-authored non-monotonic ids |
| `tests/` | 45 pytest modules + `conftest.py` |

Layering is enforced by convention (`AGENTS.md`): routers validate and delegate;
services hold logic; DAOs own SQLAlchemy; dependency injection via `Depends()`.

## Frontend Module Organisation

`frontend/src/`:

| Path | Role |
|---|---|
| `api/*.api.ts` | axios clients with a Bearer-refresh interceptor; `query-keys.ts` centralises TanStack Query keys |
| `features/player/` | `pages/SongDetailPage/`, `components/` (`StrumPatternCard`, `TrackSelector`, `ProcessButton`, `SheetSelector`, `ChordSheet`, `ChordSheetLine`), `hooks/` (`use-strum-playback`, `use-buffered-stem-mixer`, `use-audio-player`, `use-job-status-manifest`), `lib/` (`strum-pattern.ts`, `lyrics-sources.ts`) |
| `features/{auth,search,library,subscription,tuner}/` | Remaining feature modules |
| `components/shared/` | `JobWatcher.tsx` and other cross-feature components |
| `stores/` | Zustand: `auth`, `subscription`, `playback`, `player-prefs`, `song-media-cache`, `job-watcher` |
| `types/` | `song.ts`, `job.ts` (const-object `JobStatus`), `runtime-observer.d.ts` (hand-written ambient declaration) |
| `lib/`, `hooks/`, `config/` | Utilities, generic hooks, runtime config |
| `e2e/specs/` | 24 Playwright specs |
| `**/*.test.ts` | 21 co-located Vitest files |

## Code Patterns

- **Backend**: async everywhere; generic `BaseDAO[T]`; Pydantic for config and
  schemas; environment-aware secrets (`secrets.yml` locally, Secrets Manager on
  AWS); services never touch HTTP concerns.
- **Frontend**: TanStack Query v5 for server state, Zustand v5 for client state;
  feature-folder colocation; strict TypeScript (`tsc -b` gates `npm run build`).
- **Commands**: every workflow is a `just` recipe; raw `uv`/`npm`/`terraform`
  invocation is discouraged by `AGENTS.md`.
- **Comments**: unusually good *why*-rationale comments in the modified hunks;
  zero `TODO`/`FIXME`/`HACK`/`XXX` markers across `backend/src` + `frontend/src`.

## Oversized Modules

All exceed 500 lines; several approach or exceed the 1000-line ambient limit:

`job_service/core.py` 1064 · `song_service/detail.py` 1017 · `youtube_service.py`
888 · `stem_processing.py` 853 · `routers/songs.py` 848 · `SongDetailPage/index.tsx`
854 · `ChordSheetLine.tsx` 589 · `use-buffered-stem-mixer.ts` 583 ·
`ChordSheet.tsx` 569 · `use-audio-player.ts` 502. The `justfile` itself is a
61 KB / 100-recipe monolith.

## Working-Tree vs Committed vs Deployed Structure

The structure above describes the **blended working tree**, which is *not*
identical to what runs in production. `main` (`fff6aad`, 2026-07-11) is 24
tracked files behind it, plus 8 untracked paths (`+265/−114`).

Structural elements that exist **only** in the working tree and are **not
deployed**: the `POST /songs/{song_id}/self-heal` route in `routers/songs.py`,
the mute-all controls in `TrackSelector.tsx`, the song-create race handling in
`song_dao.py` / `song_service/core.py`, and the stale-closure fix. Direct
inspection of the live bundle
(`https://app.smart-guitar.com/assets/index-bUFRRukC.js`) finds no `Mute all`,
`Unmute all`, `track-selector-toggle-all`, `Self-healing started`, or
`Could not start self-healing`.

Deployed structure per component (homeserver-local tags): frontend and
`job_orchestrator` at `0c38c5b`, `stale_job_sweeper` at `82eae22`, backend API
at `32bde3f`. `_run_background_healing` remains defined in `routers/songs.py`
and is called by nothing in the working tree — dead code left by the self-heal
change, which is itself still undeployed.
