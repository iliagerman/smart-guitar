# Technology Stack — guitar_player

## Languages & Runtimes

| Language | Version | Where |
|---|---|---|
| Python | 3.13, managed by `uv` | `backend`, 4 ML services, `scripts`, `homeserver` |
| TypeScript | 5.9.3, strict | `frontend` |
| HCL (Terraform) | — | `infra` (8 modules) |
| Bash | — | `scripts/deploy/*.sh` |
| YAML/JSON | — | `grafana`, config, `docker-compose.promtail.yml` |

## Build & Command Surface

- **`just`** is the single command surface: `justfile`, 100 recipes, 61 KB.
- **`uv`** for every Python package (`uv.lock` per package; never pip/poetry).
- **npm + Vite** for the frontend; `tsc -b` is wired into `npm run build`, so
  type errors block the frontend deploy.
- **Terraform**, **Docker/ECR** for images, **Alembic** for migrations.
- Type checking: `pyrightconfig.json` (3 execution environments — backend,
  inference_demucs, chords_generator) and `tsc -b`.

Concrete recipes:

| Recipe | Effect |
|---|---|
| `just dev` / `just dev-backend` / `just dev-frontend` | Local development |
| `just test` | `just test-integration` then `just test-e2e` |
| `just test-integration` | `test-backend`, `test-demucs`, `test-chords`, `test-lyrics` |
| `just test-backend` | `uv sync --extra dev` then `APP_ENV=test uv run pytest tests/ -v -s -k "not no_cleanup"` |
| `just test-backend-file <file>` / `just test-backend-grep <pattern>` | Targeted pytest |
| `just test-frontend [args]` | Vitest (`npm run test -- …`) |
| `just test-client` / `just test-e2e` | `npx playwright test` |
| `just lint-frontend` | `npm run lint` (ESLint 9 flat config) |
| `just db-migrate` / `just db-rollback` / `just db-revision <msg>` | Alembic |
| `just tf-validate` / `just deploy-infra` | Terraform |
| `just deploy-backend` / `deploy-client` / `deploy-demucs` / `deploy-chords` / `deploy-lyrics` / `deploy-tabs` / `deploy-all` | Deployment via `scripts/deploy/*.sh` |
| `just start-sagemaker` / `just shutdown-sagemaker` | SageMaker scaling |

**Project constraint (`AGENTS.md`)**: always use `just`; never run
`uv`/`npm`/`terraform` directly. New workflows must be added as `just` recipes,
never raw shell scripts or Makefiles.

## Backend Libraries (pinned exact `==`)

`fastapi 0.129.0` · `mangum 0.21.0` · `uvicorn[standard] 0.41.0` ·
`awslambdaric 4.0.0` · `sqlalchemy[asyncio] 2.0.46` · `asyncpg 0.31.0` ·
`alembic 1.18.4` · `pydantic 2.12.5` · `boto3 1.42.53` ·
`python-jose[cryptography] 3.5.0` · `yt-dlp 2026.3.3` ·
`bgutil-ytdlp-pot-provider 1.2.2` · `httpx 0.28.1` · `psycopg2-binary 2.9.11` ·
`openai 2.21.0` · `google-genai 1.68.0` · `requests 2.32.5` · `pyyaml 6.0.3` ·
`python-json-logger 4.0.0` · `curl-cffi >=0.15.0` *(only unpinned runtime dep)* ·
`runtime-observer` *(git, unpinned ref)*.

Dev: `ruff 0.15.2` · `pytest 9.0.2` · `pytest-asyncio 1.3.0` ·
`pytest-timeout 2.4.0` · `aiosqlite 0.22.1`.

## Frontend Libraries

`react 19.2.4` / `react-dom 19.2.4` · `vite 7.3.1` · `@vitejs/plugin-react 5.1.4` ·
`@tanstack/react-query 5.90.21` · `zustand 5.0.11` · `react-router-dom 7.13.0` ·
`axios 1.13.5` · `aws-amplify 6.16.2` · `@radix-ui/react-dialog 1.1.15` ·
`@radix-ui/react-popover 1.1.15` · `tailwindcss 4.2.0` + `@tailwindcss/vite 4.2.0` ·
`lucide-react 0.575.0` · `sonner 2.0.7` · `recharts 3.8.0` · `pitchy 4.1.0` ·
`@ffmpeg/ffmpeg 0.12.15` · `@breezystack/lamejs 1.2.7` ·
`@tombatossals/chords-db ^0.5.1` *(only caret dep)* · `clsx 2.1.1` ·
`tailwind-merge 3.5.0` · `vite-plugin-pwa 1.2.0` ·
`runtime-observer github:germanilia/runtime-observer` *(unpinned)*.

Dev/test: `vitest 4.0.18` · `@playwright/test 1.58.2` + `playwright 1.58.2` ·
`eslint 9.39.3` · `typescript-eslint 8.56.0` · `eslint-plugin-react-hooks 7.0.1` ·
`eslint-plugin-react-refresh 0.4.26`.

**Documentation drift**: `wavesurfer.js` is claimed by `ARCHITECTURE.md` and
`AGENTS.md` but is **not** in `package.json` — the player uses a custom Web Audio
stem mixer (`use-buffered-stem-mixer.ts`, 583 lines). `AGENTS.md` forbids the
full Amplify SDK, yet `aws-amplify 6.16.2` (full) is installed.

## ML Service Libraries

`demucs 4.0.1` + `torchcodec 0.10.0` · `autochord 0.1.4` + `pychord 1.3.2` +
`librosa 0.11.0` + `tf-keras 2.20.1` · `whisperx 3.8.1` + `mlx-whisper >=0.4.3`
(arm64 macOS only) + `beautifulsoup4 4.14.3` + `langdetect 1.0.9` ·
`basic-pitch[onnx] 0.4.0` + `scipy 1.15.3` · `moto[s3] 5.1.21` (tests).

## Infrastructure & Platform

Terraform (8 modules) · **ECS Fargate behind a public ALB — the runtime for the
FastAPI backend** (`infra/modules/ecs/main.tf`, `deploy_ecs_container_image`;
`api.smart-guitar.com` → public ALB) · AWS Lambda (container images — the four
workers only) · ECR · SQS · CloudFront · Cognito · RDS PostgreSQL · S3 ·
SageMaker Async Inference (GPU, scale-to-zero) · CloudWatch · Grafana / Loki /
Promtail.

`mangum 0.21.0` and `awslambdaric 4.0.0` remain pinned in `backend/pyproject.toml`
and `main.py` still exports a Mangum handler, but that is a compatibility / dead
deployment path — the backend is **not** served by Lambda or API Gateway.

## Stack Constraints (from `AGENTS.md`)

- Python 3.13 via `uv`; FastAPI (documented as "FastAPI + Mangum", but the
  deployed backend is an ECS Fargate container, not Lambda); Pydantic for all
  config and schemas.
- SQLAlchemy async + Alembic; PostgreSQL is the sole database.
- React 19 + TypeScript + Vite; Tailwind v4 + shadcn/ui.
- Terraform only — no CloudFormation, no CDK.
- `Justfile` only — no Makefile.
- DAO pattern (`BaseDAO[T]`), service layer, thin routers, `Depends()` DI.
- Secrets from `secrets.yml` locally and Secrets Manager on AWS; never hardcoded.
- No public S3 buckets or RDS endpoints; everything except CloudFront and the
  public ALB sits in a private VPC.
- Every Terraform module must have `variables.tf` + `outputs.tf`.
