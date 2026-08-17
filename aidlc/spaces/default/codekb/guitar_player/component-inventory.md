# Component Inventory — guitar_player

Component names below are the canonical identifiers used by the
`## Scope of Analysis` block in `reverse-engineering-timestamp.md`.

## Runtime Components

### backend

- **Path**: `backend/` (`guitar-player-backend`)
- **Type**: FastAPI REST service running as a **container task on ECS Fargate
  behind a public ALB** (`infra/modules/ecs/main.tf`:
  `aws_ecs_task_definition.backend` + `aws_ecs_service.backend`;
  `scripts/deploy/backend.sh` → `deploy_ecs_container_image`;
  `api.smart-guitar.com` resolves to the public ALB). `main.py` also exports a
  Mangum handler — a compatibility / dead deployment path, not the active runtime.
- **Language**: Python 3.13
- **Responsibility**: the single front door — auth, songs, jobs, favorites,
  subscription, analytics, admin. Owns PostgreSQL and S3 access, the processing
  lock, job creation, LLM metadata enrichment, and worker invocation.
- **Depends on**: PostgreSQL (RDS), S3, Cognito, `lambda-workers`, `homeserver`,
  the four ML services, Bedrock/Google GenAI/OpenAI, AllPay/Paddle, Telegram,
  `runtime-observer`.
- **Deployed by**: `just deploy-backend` → `scripts/deploy/backend.sh`

### frontend

- **Path**: `frontend/` (`smart-guitar-frontend`)
- **Type**: React 19 + TypeScript SPA on Vite, PWA
- **Responsibility**: search, library, favorites, auth, subscription, tuner, and
  the player — Web Audio stem mixer with per-stem mute, chord sheet, lyrics,
  tabs, strum grid. The "Mute all / Unmute all" batch control is working-tree
  only; the live bundle
  (`https://app.smart-guitar.com/assets/index-bUFRRukC.js`) does not contain it.
- **Deployed commit**: `0c38c5b` (tag `frontend_20260815_205451`, homeserver-local).
  Consistent with the live bundle on the distinguishing features — it contains
  `instrumentConsole` and the ProcessButton manifest-completion fix, and its
  `TrackSelector.tsx` has no mute-all controls.
- **Depends on**: `backend` REST `/api/v1` + SSE, S3 job-status manifest,
  Cognito, `runtime-observer`.
- **Deployed by**: `just deploy-client` → `scripts/deploy/client.sh` (S3 +
  CloudFront)

### inference_demucs

- **Path**: `inference_demucs/` — ML HTTP microservice, port 8000, Python 3.13
- **Responsibility**: Demucs 4 source separation into stems.
- **Depends on**: SageMaker Async Inference (GPU, scale-to-zero), S3,
  `runtime-observer`.
- **Deployed by**: `just deploy-demucs`

### chords_generator

- **Path**: `chords_generator/` — ML HTTP microservice, port 8001, Python 3.13
- **Responsibility**: Autochord/PyChord chord recognition, simplification levels,
  capo suggestion.
- **Depends on**: S3, `runtime-observer`.
- **Deployed by**: `just deploy-chords`

### lyrics_generator

- **Path**: `lyrics_generator/` — ML HTTP microservice, port 8003, Python 3.13
- **Responsibility**: WhisperX word-level lyrics with Genius alignment;
  MLX-Whisper on arm64 macOS.
- **Depends on**: Genius, S3, `runtime-observer`.
- **Deployed by**: `just deploy-lyrics`

### tabs_generator

- **Path**: `tabs_generator/` — ML HTTP microservice, port 8004, Python 3.13
- **Responsibility**: basic-pitch/librosa string+fret tab generation with
  confidence scores.
- **Depends on**: S3, `runtime-observer`.
- **Deployed by**: `just deploy-tabs`

### lambda-workers

- **Path**: `backend/src/guitar_player/lambdas/` (+ `backend/Dockerfile.*`)
- **Type**: four container Lambdas — `job_orchestrator`, `stale_job_sweeper`,
  `unconfirmed_user_cleanup`, `vocals_guitar_stitch` (shared `runtime.py`)
- **Responsibility**: orchestrate the ML fan-out, sweep jobs idle >16 minutes,
  clean unconfirmed Cognito users, stitch vocals + guitar.
- **Depends on**: the four ML services, S3, PostgreSQL.
- **Deployed by**: `just deploy-job-orchestrator`, `deploy-stale-job-sweeper`,
  `deploy-unconfirmed-user-cleanup`, `deploy-vocals-guitar-stitch`
- **Deployed commits** (per homeserver-local tags): `job_orchestrator` →
  `0c38c5b` (`job_orchestrator_prod_20260815_205332`, includes the progress-
  completion fix); `stale_job_sweeper` → `82eae22`
  (`stale_job_sweeper_prod_20260815_164918`, includes the `ffmpeg` image fix).
  Deployment is therefore **per-component and not uniform** — see
  `code-quality-assessment.md` § "Deployed-commit map".

### homeserver

- **Path**: `homeserver/` (2 files: `youtube_downloader.py`, `Dockerfile`)
- **Type**: on-premises sidecar
- **Responsibility**: perform YouTube downloads off AWS IP ranges to avoid bot
  checks.
- **Depended on by**: `backend` (`youtube_service.py`).
- **Deployed by**: `just deploy-homeserver`

## Supporting Components

### infra

- **Path**: `infra/` — Terraform, 8 modules: `cdn`, `cognito`, `database`, `dns`,
  `ecr`, `ecs`, `networking`, `storage`.
- **Risk**: state is local (`infra/terraform.tfstate` in-tree), not remote-backed.
- **Deployed by**: `just deploy-infra`, validated by `just tf-validate`

### scripts

- **Path**: `scripts/` + root `pyproject.toml` (`guitar-player` package)
- **Responsibility**: backfills, chord evaluation, artefact validation, regen
  supervisor, and `scripts/deploy/*.sh` (shared `_lib.sh`, which reads
  `infra-outputs.json` + `secrets.yml` / `prod.secrets.yml` and calls `git_tag`).

### grafana

- **Path**: `grafana/` — Loki, Promtail, provisioning config; plus
  `docker-compose.promtail.yml`.
- **Responsibility**: log aggregation and dashboards.
- **Deployed by**: `just deploy-grafana`, `just deploy-loki`, `just start-promtail`

### homepage

- **Path**: `homepage/` — static marketing site (index, privacy, terms, refund).
- **Deployed by**: `just deploy-homepage`

## Non-Runtime Directories

`docs/`, `brand-assets/`, `promo-video/`, `iot-telemetry-agent/`,
`video-project-*/` are peripheral and not part of the application runtime.
