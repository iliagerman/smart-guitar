# Guitar Player API

FastAPI backend for the Guitar Player application. Provides YouTube song search, audio download, stem separation, chord recognition, and user favorites management.

**Base URL:** `/api/v1` (configurable via `app.api_prefix`)
**Auth:** Bearer token (AWS Cognito JWT) required on all endpoints except health and auth routes.

---

## Health

### `GET /health`

Returns service health status. No authentication required.

**Response** `200`
```json
{
  "status": "ok",
  "environment": "local"
}
```

---

## Authentication

All auth endpoints are unauthenticated. Backed by AWS Cognito.

### `POST /auth/register`

Register a new user account.

**Request**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response** `201`
```json
{
  "user_sub": "abc-123-uuid",
  "user_confirmed": false,
  "message": "User registered. Check email for confirmation code."
}
```

**Errors**
| Status | Condition                                                                                 |
| ------ | ----------------------------------------------------------------------------------------- |
| 409    | Email already registered (`UsernameExistsException`)                                      |
| 400    | Weak password (`InvalidPasswordException`) or invalid input (`InvalidParameterException`) |

---

### `POST /auth/confirm`

Confirm email address with the code sent during registration.

**Request**
```json
{
  "email": "user@example.com",
  "confirmation_code": "123456"
}
```

**Response** `200`
```json
{
  "message": "Email confirmed successfully."
}
```

**Errors**
| Status | Condition                                                                 |
| ------ | ------------------------------------------------------------------------- |
| 404    | User not found (`UserNotFoundException`)                                  |
| 400    | Invalid or expired code (`CodeMismatchException`, `ExpiredCodeException`) |

---

### `POST /auth/login`

Authenticate and receive JWT tokens.

**Request**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response** `200`
```json
{
  "access_token": "eyJ...",
  "id_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

**Errors**
| Status | Condition                                         |
| ------ | ------------------------------------------------- |
| 401    | Wrong password (`NotAuthorizedException`)         |
| 403    | Email not confirmed (`UserNotConfirmedException`) |
| 404    | User not found (`UserNotFoundException`)          |
| 429    | Too many attempts (`TooManyRequestsException`)    |

---

### `POST /auth/refresh`

Refresh an expired access token.

**Request**
```json
{
  "refresh_token": "eyJ..."
}
```

**Response** `200`
```json
{
  "access_token": "eyJ...",
  "id_token": "eyJ...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

**Errors**
| Status | Condition                                                   |
| ------ | ----------------------------------------------------------- |
| 401    | Invalid or expired refresh token (`NotAuthorizedException`) |

---

## Songs

All song endpoints require a valid Bearer token in the `Authorization` header.

### `POST /api/v1/songs/search`

Search YouTube for songs. Results are enriched via LLM parsing to extract structured artist/song names and genre, and cross-referenced with the local database to flag songs that have already been downloaded.

**Request**
```json
{
  "query": "led zeppelin stairway to heaven"
}
```

**Response** `200`
```json
{
  "results": [
    {
      "artist": "led_zeppelin",
      "song": "stairway_to_heaven",
      "genre": "rock",
      "youtube_id": "dQw4w9WgXcQ",
      "title": "Led Zeppelin - Stairway to Heaven (Official Audio)",
      "link": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "duration_seconds": 482,
      "exists_locally": true,
      "song_id": "550e8400-e29b-41d4-a716-446655440000"
    }
  ]
}
```

Results are sorted with locally available songs first.

---

### `POST /api/v1/songs/select`

Select a song by name. If the song already exists in the database, returns its full detail. Otherwise, downloads it from YouTube first, then returns the detail.

**Request**
```json
{
  "song_name": "led_zeppelin/stairway_to_heaven",
  "youtube_id": "dQw4w9WgXcQ"
}
```

`youtube_id` is optional. If the song doesn't exist locally, `youtube_id` is used to download it.

**Response** `200`
```json
{
  "song": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "youtube_id": "dQw4w9WgXcQ",
    "title": "Led Zeppelin - Stairway to Heaven",
    "artist": "Led Zeppelin",
    "duration_seconds": 482,
    "song_name": "led_zeppelin/stairway_to_heaven",
    "thumbnail_key": "led_zeppelin/stairway_to_heaven/thumbnail.jpg",
    "audio_key": "led_zeppelin/stairway_to_heaven/audio.mp3",
    "genre": "rock",
    "play_count": 0,
    "like_count": 0,
    "created_at": "2026-01-15T10:00:00Z"
  },
  "thumbnail_url": "https://...",
  "audio_url": "https://...",
  "stems": {
    "vocals": "https://...",
    "drums": "https://...",
    "bass": "https://...",
    "guitar": "https://...",
    "piano": "https://...",
    "other": "https://...",
    "guitar_removed": "https://..."
  },
  "stem_types": [
    { "name": "vocals", "label": "Vocals" },
    { "name": "guitar", "label": "Guitar" },
    { "name": "guitar_removed", "label": "Guitar Removed" }
  ],
  "chords": [
    { "start_time": 0.0, "end_time": 2.5, "chord": "Am" },
    { "start_time": 2.5, "end_time": 5.0, "chord": "G" }
  ],
  "chord_options": [
    {
      "name": "intermediate",
      "description": "Intermediate chords",
      "capo": 0,
      "chords": [{ "start_time": 0.0, "end_time": 2.5, "chord": "Am" }]
    }
  ],
  "lyrics": [
    {
      "start": 12.5,
      "end": 15.3,
      "text": "Mama, take this badge off of me",
      "words": [
        { "word": "Mama,", "start": 12.5, "end": 12.9 },
        { "word": "take", "start": 13.0, "end": 13.3 }
      ]
    }
  ],
  "tabs": [
    { "start_time": 0.5, "end_time": 0.8, "string": 3, "fret": 0, "midi_pitch": 55, "confidence": 0.92 },
    { "start_time": 0.83, "end_time": 1.2, "string": 4, "fret": 1, "midi_pitch": 60, "confidence": 0.87 }
  ]
}
```

Stem URLs, chords, lyrics, and tabs are only populated if the song has been processed. URLs are presigned (S3) or absolute paths (local). `stem_types` lists which stems were actually produced by the processing job. `chord_options` contains simplified chord variants (e.g., beginner, intermediate, with capo positions). Lyrics segments contain word-level timestamps from speech-to-text transcription; a post-processing step uses an LLM to strip non-lyrics preamble (copyright notices, URLs, etc.) before persisting.

**StemType fields:**

| Field   | Type   | Description                                                 |
| ------- | ------ | ----------------------------------------------------------- |
| `name`  | string | Stem identifier (e.g. `vocals`, `guitar`, `guitar_removed`) |
| `label` | string | Human-readable label                                        |

**ChordOption fields:**

| Field         | Type         | Description                                          |
| ------------- | ------------ | ---------------------------------------------------- |
| `name`        | string       | Option name (e.g. `intermediate`, `beginner_capo_5`) |
| `description` | string       | Human-readable description                           |
| `capo`        | int          | Capo fret position (0 = no capo)                     |
| `chords`      | ChordEntry[] | Chord timeline for this option                       |

**LyricsSegment fields:**

| Field   | Type         | Description                   |
| ------- | ------------ | ----------------------------- |
| `start` | float        | Segment start time in seconds |
| `end`   | float        | Segment end time in seconds   |
| `text`  | string       | Full segment text             |
| `words` | LyricsWord[] | Word-level timestamps         |

**LyricsWord fields:**

| Field   | Type   | Description                |
| ------- | ------ | -------------------------- |
| `word`  | string | The word                   |
| `start` | float  | Word start time in seconds |
| `end`   | float  | Word end time in seconds   |

**TabNote fields:**

| Field        | Type  | Description                                      |
| ------------ | ----- | ------------------------------------------------ |
| `start_time` | float | Note start time in seconds                       |
| `end_time`   | float | Note end time in seconds                         |
| `string`     | int   | Guitar string, 0-indexed from low E (0=E2, 5=E4) |
| `fret`       | int   | Fret position (0=open string, 1-24)              |
| `midi_pitch` | int   | MIDI note number (e.g. 40=E2, 60=C4)             |
| `confidence` | float | Detection confidence (0.0-1.0)                   |

---

### `POST /api/v1/songs/download`

Download a song from YouTube by its video ID. Downloads the audio and thumbnail, parses the title with LLM to extract artist/song/genre metadata, and stores the files.

**Request**
```json
{
  "youtube_id": "dQw4w9WgXcQ"
}
```

**Response** `200`
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "youtube_id": "dQw4w9WgXcQ",
  "title": "Led Zeppelin - Stairway to Heaven",
  "artist": "Led Zeppelin",
  "duration_seconds": 482,
  "song_name": "led_zeppelin/stairway_to_heaven",
  "thumbnail_key": "led_zeppelin/stairway_to_heaven/thumbnail.jpg",
  "audio_key": "led_zeppelin/stairway_to_heaven/audio.mp3",
  "genre": "rock",
  "play_count": 0,
  "like_count": 0,
  "created_at": "2026-01-15T10:00:00Z"
}
```

If the song already exists (by `youtube_id` or parsed `song_name`), returns the existing record instead of re-downloading.

---

### `GET /api/v1/songs`

List all songs in the database, with optional search and genre filtering, paginated.

**Query Parameters**
| Param    | Type   | Default | Description                                          |
| -------- | ------ | ------- | ---------------------------------------------------- |
| `query`  | string | null    | Search title and artist (case-insensitive substring) |
| `genre`  | string | null    | Filter by genre                                      |
| `offset` | int    | 0       | >= 0                                                 |
| `limit`  | int    | 50      | 1-100                                                |

**Response** `200`
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "youtube_id": "dQw4w9WgXcQ",
      "title": "Led Zeppelin - Stairway to Heaven",
      "artist": "Led Zeppelin",
      "duration_seconds": 482,
      "song_name": "led_zeppelin/stairway_to_heaven",
      "thumbnail_key": "...",
      "audio_key": "...",
      "genre": "rock",
      "play_count": 42,
      "like_count": 5,
      "created_at": "2026-01-15T10:00:00Z"
    }
  ],
  "total": 150,
  "offset": 0,
  "limit": 50
}
```

---

### `GET /api/v1/songs/top`

Get top songs ranked by likes, plays, or most recently added. Supports optional genre filtering and pagination.

**Query Parameters**
| Param    | Type   | Default       | Description                                                                                           |
| -------- | ------ | ------------- | ----------------------------------------------------------------------------------------------------- |
| `genre`  | string | null          | Filter by genre                                                                                       |
| `sort`   | string | `"favorites"` | Ranking mode: `favorites` (by `like_count`), `plays` (by `play_count`), or `recent` (by `created_at`) |
| `offset` | int    | 0             | >= 0                                                                                                  |
| `limit`  | int    | 50            | 1-200                                                                                                 |

**Response** `200` — `PaginatedSongsResponse`
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Led Zeppelin - Stairway to Heaven",
      "artist": "Led Zeppelin",
      "song_name": "led_zeppelin/stairway_to_heaven",
      "genre": "rock",
      "play_count": 42,
      "like_count": 12,
      "created_at": "2026-01-15T10:00:00Z"
    }
  ],
  "total": 150,
  "offset": 0,
  "limit": 50
}
```

---

### `GET /api/v1/songs/recent`

Get globally recent songs, ordered by creation date (newest first), paginated.

**Query Parameters**
| Param    | Type | Default | Description |
| -------- | ---- | ------- | ----------- |
| `offset` | int  | 0       | >= 0        |
| `limit`  | int  | 50      | 1-100       |

**Response** `200` — `PaginatedSongsResponse` (same structure as `/top`).

---

### `GET /api/v1/songs/genres`

Get all genres with their song counts.

**Response** `200`
```json
{
  "genres": [
    { "genre": "rock", "count": 45 },
    { "genre": "pop", "count": 32 },
    { "genre": "metal", "count": 18 }
  ]
}
```

---

### `POST /api/v1/songs/{song_id}/play`

Increment the play count for a song. The `play_count` field on the song is atomically incremented.

**Path Parameters**
| Param     | Type |
| --------- | ---- |
| `song_id` | UUID |

**Response** `204` — No content.

**Errors**
| Status | Condition      |
| ------ | -------------- |
| 404    | Song not found |

---

### `GET /api/v1/songs/{song_id}/stream`

Stream a song file (audio, thumbnail, or stem) directly. Used for local development where presigned URLs are not applicable.

**Path Parameters**
| Param     | Type |
| --------- | ---- |
| `song_id` | UUID |

**Query Parameters**
| Param  | Type   | Required | Description                                                                                              |
| ------ | ------ | -------- | -------------------------------------------------------------------------------------------------------- |
| `stem` | string | yes      | File type: `audio`, `thumbnail`, `vocals`, `drums`, `bass`, `guitar`, `piano`, `other`, `guitar_removed` |

**Response** `200` — File stream (`FileResponse`).

If the requested stem file is missing and the stem is reprocessable, the server automatically triggers a background reprocessing job and returns `404` with a message indicating reprocessing was triggered. The client can retry after the job completes.

**Errors**
| Status | Condition                                                                           |
| ------ | ----------------------------------------------------------------------------------- |
| 400    | Unknown stem type                                                                   |
| 404    | File not found (may include "reprocessing triggered" or "reprocessing in progress") |

---

### `GET /api/v1/songs/{song_id}`

Get full detail for a single song, including resolved URLs for audio, thumbnail, stems, and chord data.

This endpoint performs best-effort admin healing on access: if audio/thumbnail files are missing it attempts to recover them, if stems/chords are missing it triggers a background reprocessing job, and if only lyrics are missing (but vocals exist) it enqueues a lightweight lyrics transcription. Admin heal failures are logged but never block the response.

**Path Parameters**
| Param     | Type |
| --------- | ---- |
| `song_id` | UUID |

**Response** `200` — `SongDetailResponse` (same structure as the `/select` response). Includes `tabs` array with note-level guitar tablature if tab transcription has been completed.

**Errors**
| Status | Condition      |
| ------ | -------------- |
| 404    | Song not found |

---

## Jobs

Processing jobs handle stem separation (via Demucs), chord recognition, and tab transcription. All endpoints require Bearer token auth.

### `POST /api/v1/jobs`

Create a new processing job for a song. The job runs stem separation and chord recognition asynchronously via external microservices.

**Request**
```json
{
  "song_id": "550e8400-e29b-41d4-a716-446655440000",
  "descriptions": ["vocals", "drums"],
  "mode": "isolate"
}
```

| Field          | Type     | Description                            |
| -------------- | -------- | -------------------------------------- |
| `song_id`      | UUID     | The song to process                    |
| `descriptions` | string[] | Stem descriptions to isolate           |
| `mode`         | string   | Processing mode (default: `"isolate"`) |

**Response** `200`
```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "user_id": "770e8400-e29b-41d4-a716-446655440002",
  "song_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "PENDING",
  "progress": null,
  "stage": null,
  "descriptions": ["vocals", "drums"],
  "mode": "isolate",
  "error_message": null,
  "results": null,
  "created_at": "2026-01-15T10:30:00Z",
  "updated_at": "2026-01-15T10:30:00Z",
  "completed_at": null
}
```

| Field      | Type           | Description                                                                                                                  |
| ---------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `progress` | int or null    | Progress percentage (0-100), null when not yet started                                                                       |
| `stage`    | string or null | Human-readable stage (e.g. `"queued"`, `"separating"`, `"recognizing_chords"`, `"transcribing_lyrics"`, `"generating_tabs"`) |

---

### `GET /api/v1/jobs/{job_id}/events`

Server-Sent Events (SSE) stream for real-time job progress. The client subscribes with `EventSource` and receives updates without polling.

**Path Parameters**
| Param    | Type |
| -------- | ---- |
| `job_id` | UUID |

**Response** `200` — `text/event-stream`

**Event Types:**

| Event   | Data                    | Description                                                               |
| ------- | ----------------------- | ------------------------------------------------------------------------- |
| `hello` | `{}`                    | Sent immediately on connection to confirm the stream is alive             |
| `job`   | Full `JobResponse` JSON | Sent whenever the job status, progress, or stage changes                  |
| `done`  | `{}`                    | Sent when the job reaches `COMPLETED` or `FAILED`, then the stream closes |

The stream polls every 1 second and only emits `job` events when the payload changes.

---

### `GET /api/v1/jobs/{job_id}`

Get the status and results of a processing job. When the job is completed, result entries include resolved URLs for the separated stems.

**Path Parameters**
| Param    | Type |
| -------- | ---- |
| `job_id` | UUID |

**Response** `200`
```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "user_id": "770e8400-e29b-41d4-a716-446655440002",
  "song_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "COMPLETED",
  "progress": 100,
  "stage": "generating_tabs",
  "descriptions": ["vocals", "drums"],
  "mode": "isolate",
  "error_message": null,
  "results": [
    {
      "description": "vocals",
      "target_key": "https://...",
      "residual_key": "https://..."
    },
    {
      "description": "drums",
      "target_key": "https://...",
      "residual_key": "https://..."
    }
  ],
  "created_at": "2026-01-15T10:30:00Z",
  "updated_at": "2026-01-15T10:31:00Z",
  "completed_at": "2026-01-15T10:31:00Z"
}
```

**Job Statuses:** `PENDING` → `COMPLETED` | `FAILED`

---

### `GET /api/v1/jobs`

List the current user's processing jobs, ordered by creation date (newest first).

**Query Parameters**
| Param    | Type | Default      |
| -------- | ---- | ------------ |
| `offset` | int  | 0            |
| `limit`  | int  | 50 (max 100) |

**Response** `200` — Array of `JobResponse` objects (bare list, not paginated).

---

## Favorites

Manage a per-user list of favorited songs. All endpoints require Bearer token auth.

### `POST /api/v1/favorites`

Add a song to the current user's favorites. Also increments the song's `like_count`.

**Request**
```json
{
  "song_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response** `201`
```json
{
  "id": "880e8400-e29b-41d4-a716-446655440003",
  "user_id": "770e8400-e29b-41d4-a716-446655440002",
  "song_id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2026-01-15T12:00:00Z",
  "song": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Led Zeppelin - Stairway to Heaven",
    "artist": "Led Zeppelin",
    "song_name": "led_zeppelin/stairway_to_heaven"
  }
}
```

**Errors**
| Status | Condition                 |
| ------ | ------------------------- |
| 409    | Song already in favorites |

---

### `DELETE /api/v1/favorites/{song_id}`

Remove a song from the current user's favorites. Also decrements the song's `like_count`.

**Path Parameters**
| Param     | Type |
| --------- | ---- |
| `song_id` | UUID |

**Response** `204` — No content.

**Errors**
| Status | Condition             |
| ------ | --------------------- |
| 404    | Song not in favorites |

---

### `GET /api/v1/favorites`

List the current user's favorited songs, ordered by most recently added.

**Query Parameters**
| Param    | Type | Default |
| -------- | ---- | ------- |
| `offset` | int  | 0       |
| `limit`  | int  | 50      |

**Response** `200`
```json
{
  "favorites": [
    {
      "id": "880e8400-e29b-41d4-a716-446655440003",
      "user_id": "770e8400-e29b-41d4-a716-446655440002",
      "song_id": "550e8400-e29b-41d4-a716-446655440000",
      "created_at": "2026-01-15T12:00:00Z",
      "song": { "..." }
    }
  ]
}
```

---

## Admin (Operational)

Operational endpoints for automated song repair. These are **not user-facing** — they are used by the `admin_runner.py` script. Authentication uses a dedicated shared-secret token (configured via `admin.api-key` in secrets.yml), not the standard Cognito Bearer token.

### `GET /api/v1/admin/required`

List songs that need repair (missing audio, stems, chords, lyrics, or tabs).

**Query Parameters**
| Param           | Type | Default | Description                                       |
| --------------- | ---- | ------- | ------------------------------------------------- |
| `offset`        | int  | 0       | Pagination offset (>= 0)                          |
| `limit`         | int  | 100     | Songs to return per page (1-500)                  |
| `check_storage` | bool | true    | Whether to verify files actually exist on disk/S3 |
| `max_scan`      | int  | 0       | Max songs to scan from DB (0 = use default)       |

**Response** `200`
```json
{
  "items": [
    {
      "song_id": "550e8400-e29b-41d4-a716-446655440000",
      "song_name": "led_zeppelin/stairway_to_heaven",
      "reasons": ["stems", "lyrics"]
    }
  ],
  "scanned": 500,
  "next_offset": 100
}
```

---

### `POST /api/v1/admin/songs/{song_id}/heal`

Trigger admin healing for a single song. Attempts to fix audio/thumbnail, reprocess stems/chords if missing, and enqueue lyrics transcription if needed.

**Path Parameters**
| Param     | Type |
| --------- | ---- |
| `song_id` | UUID |

**Response** `200`
```json
{
  "song_id": "550e8400-e29b-41d4-a716-446655440000",
  "audio_thumbnail_fixed": true,
  "reprocess_triggered": false,
  "lyrics_enqueued": true,
  "warnings": []
}
```

| Field                   | Type     | Description                                     |
| ----------------------- | -------- | ----------------------------------------------- |
| `audio_thumbnail_fixed` | bool     | Whether audio/thumbnail recovery was performed  |
| `reprocess_triggered`   | bool     | Whether a stem reprocessing job was enqueued    |
| `lyrics_enqueued`       | bool     | Whether a lyrics transcription job was enqueued |
| `warnings`              | string[] | Non-fatal errors encountered during healing     |

---

### `POST /api/v1/admin/seed/populate`

Populate the **predefined seed catalog** (from `SEED_SONGS`) into local filesystem storage and the database.

This is an **operational/local** convenience endpoint, protected by the same shared-secret Bearer token as other admin routes.

Notes:
- Requires `storage.backend = "local"`.
- Idempotent: skips existing songs (by `song_name`) and only enriches missing metadata.
- Does **not** enqueue demucs/chords/lyrics/tabs jobs.

**Response** `200`
```json
{
  "storage_backend": "local",
  "base_path": "../local_bucket",
  "dirs_created": 105,
  "songs_synced": 105,
  "metadata_updated": 105
}
```

---

## Common Error Responses

All error responses follow this format:

```json
{
  "detail": "Description of the error"
}
```

| Status | Meaning                               |
| ------ | ------------------------------------- |
| 400    | Bad request / validation error        |
| 401    | Missing or invalid Bearer token       |
| 403    | Forbidden (e.g., email not confirmed) |
| 404    | Resource not found                    |
| 409    | Conflict (duplicate resource)         |
| 429    | Rate limited                          |

---

## Local Development

Set `APP_ENV=local` and `SKIP_AUTH=1` to bypass Cognito authentication. All authenticated endpoints will use a default dev user (`sub: "local-dev-user"`, `email: "dev@local.test"`).

In local mode, the server auto-syncs songs from the `./local_bucket` directory into the database on startup.

The predefined **dummy seed catalog** is **not** auto-populated on startup. To populate it explicitly, use one of:
- `just seed-db` (runs `backend/scripts/seed_db.py`)
- `POST /api/v1/admin/seed/populate` (operational endpoint; requires `admin.api-key`)
