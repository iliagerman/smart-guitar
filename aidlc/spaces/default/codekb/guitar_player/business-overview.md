# Business Overview — guitar_player (Smart Guitar)

## Purpose

Smart Guitar is a consumer web application for guitar players who want to learn
and play along with real recordings. A user searches YouTube for a song, the
system downloads the audio, splits it into instrument stems, recognises the
chords, transcribes the lyrics with word-level timing, and generates guitar
tabs. The player then plays all of that back in sync: a chord sheet, a lyrics
line, a strum grid, and a stem mixer the user can mute track by track.

The product is live in production at `app.smart-guitar.com` (API at
`api.smart-guitar.com`), backed by a paid subscription with a 14-day trial.

## Business Domain

| Domain concept | Meaning in this system |
|---|---|
| **Song** | A YouTube-sourced recording enriched with derived artefacts: audio, stems, chords, lyrics, tabs. Keyed by `youtube_id` and a unique `song_name`. |
| **Job** | One asynchronous processing run over a song. Carries `status`, `progress`, `stage`, and a `results` JSON blob. |
| **Processing lock** | `songs.processing_job_id` — prevents two concurrent jobs on the same song. |
| **Stem** | An isolated instrument track produced by source separation: vocals, guitar, drums, bass, piano, other. |
| **Chord sheet / strum grid** | The playable rendering of recognised chords, with simplification levels, capo suggestion, and per-step strum directions. |
| **Favorite** | A user's saved song. |
| **Subscription** | Trial or paid entitlement, provider-abstracted across AllPay and Paddle. |
| **Healing / self-heal** | Repair of a song whose derived artefact (a stem, chords, lyrics) is missing or unusable. |

## Key Functionality

1. **Search & ingest** — YouTube search via `yt-dlp`; download routed through an
   on-premises `homeserver` sidecar to avoid AWS-IP bot checks; LLM metadata
   parsing (Bedrock Nova / Google GenAI / OpenAI) turns a messy YouTube title
   into clean artist / song / genre.
2. **Processing pipeline** — an orchestrator Lambda fans a song out to four ML
   microservices (Demucs stems, Autochord chords, WhisperX lyrics, basic-pitch
   tabs), then stitches vocals + guitar.
3. **Progress reporting** — three concurrent channels: SSE (`/api/v1/jobs`
   events), REST polling, and an S3 job-status manifest.
4. **Playback** — a custom Web Audio stem mixer with per-stem mute, synchronised
   chord sheet, lyrics, tabs, and an animated strum grid. A "Mute all / Unmute
   all" batch control exists in the working tree only and is **not** in the
   currently deployed frontend bundle.
5. **Repair** — operator-facing `/api/v1/admin` heal / reprocess / drop
   endpoints. The client-triggered `POST /api/v1/songs/{song_id}/self-heal`
   exists in the working tree only and is **not** in the deployed backend.
6. **Accounts & billing** — Cognito auth (email/password + Google OAuth),
   subscription guard on the core routes, payment-provider webhooks.
7. **Observability** — Grafana/Loki/Promtail, CloudWatch, and a `runtime-observer`
   SDK shared by the frontend and all five Python packages; Telegram error
   notifications.

## Current Business Context for This Intent

The active intent (`260816-homeserver-reconcile`, scope `bugfix`) is a
**reconciliation**, not a feature. The business-critical fact is that several
user-visible behaviours — the "Mute all / Unmute all" batch control, `self-heal`,
the song-create race handling, and the stale-closure fix — **exist only as
uncommitted working-tree state and are not deployed**. Direct inspection of the
live bundle at `https://app.smart-guitar.com/assets/index-bUFRRukC.js` finds
`instrumentConsole` but **no** `Mute all`, `Unmute all`,
`track-selector-toggle-all`, `Self-healing started`, or
`Could not start self-healing` — so these are pending value, not shipped value.

The strum-grid direction behaviour additionally has two mutually contradicting
implementations (committed vs working tree), each with its own green test suite,
so restoring it is a product decision rather than a merge.

These uncommitted changes can be **lost** by a `checkout`, `reset`, `stash`, or
`clean` unless they are committed or backed up. A backup of the pre-reconcile
tree was taken this session at
`/tmp/guitar-player-before-reconcile-20260816-230659`.

See `code-quality-assessment.md` for the full divergence analysis.
