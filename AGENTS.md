# Guitar Player - Project Rules

## Stack

- **Python 3.13** managed by `uv` (not pip/poetry)
- **FastAPI** with Mangum for Lambda deployment
- **Pydantic** for all config, request/response schemas, and validation
- **SQLAlchemy** (async) with Alembic for migrations
- **PostgreSQL** as the sole database
- **React 19 + TypeScript + Vite** for the frontend
- **Tailwind CSS v4 + shadcn/ui** for styling
- **Terraform** for all infrastructure (no CloudFormation, no CDK)
- **Justfile** for all project commands (not Makefile)

## Backend Patterns

- **DAO pattern**: generic `BaseDAO[T]` with CRUD, domain DAOs extend it
- **Service layer**: business logic lives in `services/`, not in routers
- **Routers** are thin — validate input, call service, return response
- **Dependency injection** via FastAPI `Depends()` for auth, DB sessions, services
- **Environment-aware config**: `secrets.yml` locally, Secrets Manager on AWS — never hardcode secrets
- **Async everywhere**: async SQLAlchemy sessions, async route handlers

## Frontend Patterns

- **TanStack Query v5** for server state, **Zustand v5** for client state
- **`@aws-amplify/auth`** (standalone) for Cognito — not full Amplify
- **wavesurfer.js** for audio waveform, **Web Audio API** for stem mixing
- **Mobile-first** responsive design with Tailwind breakpoints

## Infrastructure

- Every Terraform module has `variables.tf` + `outputs.tf`
- All services in private VPC except CloudFront and API Gateway
- S3 keys: `raw/{youtube_id}.wav` for downloads, `processed/{job_id}/{desc}_{target|residual}.wav` for stems
- SageMaker Async Inference with scale-to-zero (not Serverless — no GPU support)

## Testing

- **Never generate unit tests.** This project does not use unit tests.
- Testing is done via integration tests and manual verification using `just` commands.
- Integration tests via `just test-demucs` / `just test-chords` (starts API server, sends request, stops server)
- E2E: Playwright (desktop + mobile viewports)

## Commands (Justfile)

**Always use `just` commands. Never run uv/npm/terraform directly — use the corresponding just recipe.**

All project commands go in the root `Justfile`. Use `just <command>` for everything:
- `just setup-demucs` / `just setup-chords` — install subproject dependencies
- `just run-demucs` / `just run-chords` — start local API servers
- `just test-demucs` / `just test-chords` — integration test (starts server, sends request, cleans output)
- `just test-demucs cleanup=false` / `just test-chords cleanup=false` — integration test (keeps output for inspection)
- `just dev-backend` / `just dev-frontend` / `just dev` — local development
- `just test-backend` / `just test-client` — testing
- `just db-migrate` / `just db-rollback` / `just db-revision` — Alembic migrations
- `just tf-validate` — Terraform validation
- `just deploy-infra` / `just destroy-infra` — deploy/destroy AWS infrastructure
- `just deploy-backend` / `just deploy-demucs` / `just deploy-chords` / `just deploy-lyrics` / `just deploy-tabs` / `just deploy-client` / `just deploy-all` — deployment
- `just start-sagemaker` / `just shutdown-sagemaker` — SageMaker scaling

When adding new workflows, add a `just` recipe — never use raw shell scripts or Makefiles.

## Code Style

- Python: formatted with `ruff`, type hints on all function signatures
- TypeScript: strict mode, no `any` unless unavoidable
- Commits: concise message describing the "why", not the "what"

## S3 / SageMaker Contract

Input to SageMaker (JSON):
```json
{ "audio_s3_key", "descriptions": [...], "mode": "isolate"|"remove", "job_id" }
```
Output from SageMaker (JSON):
```json
{ "job_id", "results": [{ "description", "target_s3_key", "residual_s3_key" }] }
```

## What NOT to Do

- Don't install packages with pip — use `uv add`
- Don't put business logic in routers or models
- Don't generate unit tests — this project does not use them
- Don't hardcode AWS credentials or secrets
- Don't use Amplify full SDK — only `@aws-amplify/auth`
- Don't create public S3 buckets or RDS endpoints
