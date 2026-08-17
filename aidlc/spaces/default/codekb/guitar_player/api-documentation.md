# API Documentation — guitar_player

Scope note: this records the API **surface shape** observed during the scan
(routers, prefixes, endpoint counts, and endpoints explicitly identified). Full
per-endpoint request/response schemas were not read; `backend/API.md` and the
per-service `API.md` files are the detailed contracts.

## External HTTP API (FastAPI backend)

Served in production by FastAPI on **ECS Fargate behind a public Application
Load Balancer** (`api.smart-guitar.com`), not by Lambda/API Gateway. Evidence:
`infra/modules/ecs/main.tf` defines `aws_ecs_task_definition.backend` +
`aws_ecs_service.backend`, and `scripts/deploy/backend.sh` calls
`deploy_ecs_container_image`. `main.py` still exports a Mangum handler, which is
a compatibility / dead deployment path and is not the active runtime.

58 route decorators across 9 routers. Everything is mounted under `/api/v1`
except `health` and `auth`.

| Router | Prefix | Endpoints | Notes |
|---|---|---|---|
| `health` | *(none)* | 1 | Not under `api_prefix`. |
| `auth` | `/auth` | 5 | Mounted without `api_prefix`. Cognito register / login / confirm / refresh / me. |
| `songs` | `/api/v1/songs` | 20 | Largest surface. Includes the **uncommitted, undeployed** `POST /{song_id}/self-heal`. |
| `jobs` | `/api/v1/jobs` | 5 | Includes an SSE events stream. |
| `favorites` | `/api/v1/favorites` | 3 | |
| `analytics` | `/api/v1/analytics` | 10 | Undocumented in `ARCHITECTURE.md`. |
| `admin` | `/api/v1/admin` | 8 | heal / reprocess / drop operations. |
| `subscription` | `/api/v1/subscription` | 6 | |
| `subscription.webhook_router` | `/api/v1/webhooks` | *(within the 6)* | AllPay / Paddle payment callbacks. |

Endpoints named explicitly by `ARCHITECTURE.md` and confirmed in the scan:
`/auth` register, login, confirm, refresh, me · `/songs` search, select, get,
stream · `/jobs` create, get, events (SSE) · `/favorites` list, toggle ·
`/subscription` status, checkout, webhook · `/admin` heal, reprocess ·
`/health` check. Plus the working-tree-only, **not-yet-deployed**
`POST /api/v1/songs/{song_id}/self-heal`.

**Auth**: Bearer JWT from Cognito on all non-public routes; the SPA refreshes via
an axios interceptor. Core routes additionally sit behind a subscription guard.

## Internal / Service-to-Service APIs

### ML microservices (HTTP)

| Service | Port | Contract doc |
|---|---|---|
| `inference_demucs` | 8000 | `inference_demucs/API.md` |
| `chords_generator` | 8001 | `chords_generator/API.md` |
| `lyrics_generator` | 8003 | *(no `API.md`)* |
| `tabs_generator` | 8004 | `tabs_generator/API.md` |

### SageMaker Async Inference contract (from `AGENTS.md`)

```json
// request
{ "audio_s3_key": "...", "descriptions": ["..."], "mode": "isolate|remove", "job_id": "..." }
// response
{ "job_id": "...", "results": [ { "description": "...", "target_s3_key": "...", "residual_s3_key": "..." } ] }
```

### Lambda workers (invoked via boto3, not HTTP)

`job_orchestrator` · `stale_job_sweeper` · `unconfirmed_user_cleanup` ·
`vocals_guitar_stitch` (shared entry helpers in `lambdas/runtime.py`).

### On-prem sidecar

`homeserver/youtube_downloader.py` — called by
`backend/src/guitar_player/services/youtube_service.py` to perform YouTube
downloads off AWS IP ranges.

### S3 job-status manifest

A second progress channel alongside SSE and REST polling:
`backend/src/guitar_player/job_status_manifest.py` writes it; the frontend
`use-job-status-manifest.ts` polls it directly from S3.

### S3 key conventions (from `AGENTS.md`)

- `raw/{youtube_id}.wav` — downloaded source audio
- `processed/{job_id}/{desc}_{target|residual}.wav` — separated stems

## Frontend API Client

`frontend/src/api/*.api.ts` (`songs.api.ts`, `jobs.api.ts`, …) over axios with a
Bearer-token refresh interceptor. TanStack Query keys are centralised in
`api/query-keys.ts`.

## External Third-Party Integrations

YouTube (`yt-dlp` + `bgutil` PO-token provider) · AWS Bedrock Nova · Google GenAI ·
OpenAI · Genius · Ultimate Guitar (`ug_chord_fetcher.py`) · Tavily (strum/tutorial
recovery) · Telegram (error notifications) · AllPay / Paddle (payments) · AWS
Cognito.

## Provenance Warning

`POST /api/v1/songs/{song_id}/self-heal` is present in the working tree, has no
git ancestor (`git log -S'self-heal' -- backend/src` returns nothing), and is
**not deployed**: the live frontend bundle carries none of its client strings
(`Self-healing started`, `Could not start self-healing`), and the deployed
backend corresponds to `32bde3f` (tags `backend_prod_20260801_221313` and
`backend_prod_20260725_140359`), which predates it. Treat the endpoint as
pending, not shipped.

`ARCHITECTURE.md` documents neither it, the `analytics` router (10 endpoints),
nor the S3 job-status-manifest channel.
