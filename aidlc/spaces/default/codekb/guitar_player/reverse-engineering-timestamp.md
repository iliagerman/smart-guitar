# Reverse Engineering Timestamp — guitar_player

## Run Metadata

| Field | Value |
|---|---|
| Performed at (UTC) | `2026-08-16T20:38:38Z` |
| Repository | `guitar_player` |
| Workspace root | `/Users/iliagerman/Work/personal_projects/guitar_player` |
| Current commit (HEAD) | `fff6aad3119357f1cbe4fc9298dbb8238a786fd2` |
| HEAD commit date | `2026-07-11 09:14:10 +0300` |
| HEAD subject | `fix: show version only on Settings + splash, not on every screen` |
| Branch | `main` |
| Working tree state | **Dirty** — 24 modified tracked files + 8 untracked paths (`+265/−114`); `git status --porcelain` reports 33 entries |
| Active intent | `260816-homeserver-reconcile` (scope `bugfix`, brownfield) |
| Stage | `reverse-engineering` (Inception), pipeline: developer scan → architect synthesis |
| Depth | Minimal |

## Provenance Caveat

This knowledge base describes the **blended working tree**, not one committed
branch. Mac `main` is `fff6aad`; homeserver `main` is `0c38c5b` on a separately
advanced history. Current production differs from the blended tree: the live
frontend bundle has `instrumentConsole` but lacks the mute-all and self-heal
strings, while homeserver-local component tags point frontend and job
orchestrator to `0c38c5b`, backend API to `32bde3f`, and stale sweeper to
`82eae22`. Working-tree-only, undeployed changes include
`POST /api/v1/songs/{song_id}/self-heal`, per-stem mute controls, the "Mute all"
batch control, song-create race handling, and the mute-all stale-closure fix.
Root cause: Syncthing syncs files while `.stignore` excludes `.git`, so histories,
remotes, and tags never cross machines. See `code-quality-assessment.md` §
"Source Divergence — Root Cause".

## Scope of Analysis

```yaml
scope_version: 1
kind: partial
intent: 260816-homeserver-reconcile
fingerprint: 9c6b8c1e4c05d83b3b4cb469c38ce7f01d5553d9
analyzed:
  paths:
    - AGENTS.md
    - ARCHITECTURE.md
    - justfile
    - pyproject.toml
    - pyrightconfig.json
    - .gitignore
    - .stignore
    - backend/pyproject.toml
    - backend/Dockerfile.stale-job-sweeper
    - backend/src/guitar_player/main.py
    - backend/src/guitar_player/routers/
    - backend/src/guitar_player/dao/
    - backend/src/guitar_player/lambdas/
    - backend/src/guitar_player/services/song_service/core.py
    - backend/src/guitar_player/services/song_service/sheet_alignment.py
    - backend/src/guitar_player/services/job_service/stem_processing.py
    - backend/src/guitar_player/services/youtube_service.py
    - backend/tests/
    - frontend/package.json
    - frontend/vite.config.ts
    - frontend/playwright.config.ts
    - frontend/eslint.config.js
    - frontend/src/api/songs.api.ts
    - frontend/src/types/job.ts
    - frontend/src/types/song.ts
    - frontend/src/types/runtime-observer.d.ts
    - frontend/src/lib/runtime-observer.ts
    - frontend/src/components/shared/JobWatcher.tsx
    - frontend/src/features/player/lib/strum-pattern.ts
    - frontend/src/features/player/lib/strum-pattern.test.ts
    - frontend/src/features/player/lib/lyrics-sources.ts
    - frontend/src/features/player/hooks/use-strum-playback.ts
    - frontend/src/features/player/components/StrumPatternCard.tsx
    - frontend/src/features/player/components/TrackSelector.tsx
    - frontend/src/features/player/components/ProcessButton.tsx
    - frontend/src/features/player/components/SheetSelector.tsx
    - frontend/src/features/player/pages/SongDetailPage/index.tsx
    - frontend/src/e2e/specs/
    - scripts/deploy/
    - homeserver/
    - inference_demucs/pyproject.toml
    - chords_generator/pyproject.toml
    - lyrics_generator/pyproject.toml
    - tabs_generator/pyproject.toml
    - docs/
  components:
    - backend
    - frontend
    - lambda-workers
    - homeserver
    - scripts
shallow:
  paths:
    - backend/src/guitar_player/auth/
    - backend/src/guitar_player/models/
    - backend/src/guitar_player/schemas/
    - backend/src/guitar_player/utils/
    - backend/src/guitar_player/services/
    - backend/alembic/
    - backend/config/
    - backend/scripts/
    - frontend/src/features/auth/
    - frontend/src/features/search/
    - frontend/src/features/library/
    - frontend/src/features/subscription/
    - frontend/src/features/tuner/
    - frontend/src/components/
    - frontend/src/hooks/
    - frontend/src/stores/
    - frontend/src/config/
    - frontend/src/lib/
    - frontend/public/
    - frontend/plan/
    - inference_demucs/src/
    - inference_demucs/tests/
    - chords_generator/src/
    - chords_generator/tests/
    - chords_generator/scripts/
    - lyrics_generator/src/
    - lyrics_generator/tests/
    - tabs_generator/src/
    - tabs_generator/tests/
    - infra/
    - grafana/
    - homepage/
    - brand-assets/
    - promo-video/
    - iot-telemetry-agent/
```
