# Chords Generator API

HTTP API for chord recognition (BTC chords decided on Beat This! beats; see [README.md](README.md)). Accepts a path to an audio file, runs chord detection, and stores a chord timeline (JSON + LAB), the beat grid and simplified variants in the same directory as the input file.

## Running the service

```bash
just setup-chords   # dependencies + pinned model weights
just run-chords

# Or manually
APP_ENV=local uv run uvicorn chords_generator.api:app --reload --host 0.0.0.0 --port 8001
```

The `APP_ENV` environment variable selects the config profile (`local` or `prod`). Defaults to `local`.

## Endpoints

### `GET /health`

Returns service status.

**Response:**

```json
{
  "status": "ok",
  "service": "chords_generator-api"
}
```

---

### `POST /recognize`

Runs chord recognition on the given audio file.

**Request body:**

| Field                      | Type            | Required | Description                                                                                                                         |
| -------------------------- | --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `input_path`               | string          | yes      | The full mix. Local path in dev, S3 key in prod. Must be non-empty. Beats always come from it.                                      |
| `accompaniment_stem_paths` | array of string | no       | Separated non-vocal, non-drum stems (bass, guitar, piano, other). Mixed and heard by the chord model alongside the full mix. Missing paths are skipped. |

Supported input formats: MP3, WAV (any format supported by librosa).

```json
{
  "input_path": "/path/to/song.mp3"
}
```

**Success response** (`200`):

| Field         | Type             | Description                                              |
| ------------- | ---------------- | -------------------------------------------------------- |
| `status`      | string           | Always `"done"`.                                         |
| `output_path` | string           | Directory (local) or S3 prefix where outputs are stored. |
| `chords`      | array of objects | Chord timeline with start/end times and chord labels.    |
| `input_path`  | string           | Echo of the original input path.                         |

Each entry in `chords`:

| Field        | Type   | Description                                                            |
| ------------ | ------ | ---------------------------------------------------------------------- |
| `start_time` | float  | Start time in seconds.                                                 |
| `end_time`   | float  | End time in seconds.                                                   |
| `chord`      | string | Chord label in MIREX format (e.g. `G:maj`, `A:min7`, `E:sus4`, `N` for no chord). |

Example:

```json
{
  "status": "done",
  "output_path": "/path/to/local_bucket/bob_dylan/knocking_on_heavens_door",
  "chords": [
    { "start_time": 0.0, "end_time": 1.11, "chord": "N" },
    { "start_time": 1.11, "end_time": 2.97, "chord": "G:maj" },
    { "start_time": 2.97, "end_time": 4.83, "chord": "D:maj" },
    { "start_time": 4.83, "end_time": 7.99, "chord": "A:min" }
  ],
  "input_path": "/path/to/song.mp3"
}
```

**Error responses:**

| Status | Condition                     | Body                                         |
| ------ | ----------------------------- | -------------------------------------------- |
| `404`  | Input file not found          | `{"detail": "Input file not found: <path>"}` |
| `422`  | Empty or missing `input_path` | Pydantic validation error                    |
| `500`  | Recognition or internal error | `{"detail": "<error message>"}`              |

## Output files

Written to the same directory as the input audio file:

| File                                  | Description                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chords.json`                         | JSON array of chord segments with `start_time`, `end_time`, `chord`. Every change is on a tracked beat.                                                     |
| `chords.lab`                          | The same chords in MIREX LAB format (tab-separated: `start_time end_time chord`).                                                                          |
| `chord_meta.json`                     | `bpm`, `beat_times`, `downbeat_times`, `beats_per_bar`, `bar_starts` (the downbeats), `chord_model`, `beat_model`. Other fields already in the file (capo, key) are kept. |
| `chords_intermediate.json`            | Triads only (extensions stripped).                                                                                                                          |
| `chords_beginner.json`, `chords_beginner_capo_N.json` | Nearest open chords, without and with the two best capo positions.                                                                              |

Output directory structure (local):

```
local_bucket/
  bob_dylan/
    knocking_on_heavens_door/
      Bob Dylan - Knockin' On Heaven's Door (Official Audio).mp3
      vocals.mp3          # from inference_demucs
      drums.mp3           # from inference_demucs
      bass.mp3            # from inference_demucs
      guitar.mp3          # from inference_demucs
      piano.mp3           # from inference_demucs
      other.mp3           # from inference_demucs
      guitar_removed.mp3  # from inference_demucs
      vocals_removed.mp3  # from inference_demucs
      chords.json         # from chords_generator
      chords.lab          # from chords_generator
```

## Storage

Storage location depends on the environment.

### Local (filesystem)

Outputs are written to the parent directory of the input file. No separate output prefix is used.

### Prod (S3)

Outputs are uploaded to the same S3 prefix as the input file:

```
s3://ultimate_guitar_songs_archive/
  song_name/
    {youtube_id}.mp3
    chords.json
    chords.lab
```

The bucket is auto-created on startup if `create_bucket_if_missing: true` in config.

In prod, `input_path` is an S3 key. The API downloads it to a temp directory before processing, then uploads results back to S3.

## Configuration

Config files live in `chords_generator/config/`. The base config is merged with the environment-specific file selected by `APP_ENV`.

| File               | Purpose                   |
| ------------------ | ------------------------- |
| `base.config.yml`  | Shared defaults           |
| `local.config.yml` | Local filesystem storage  |
| `prod.config.yml`  | S3 storage + AWS settings |

Key config values:

| Path                               | Default                         | Description                             |
| ---------------------------------- | ------------------------------- | --------------------------------------- |
| `app.host`                         | `0.0.0.0`                       | Bind address                            |
| `app.port`                         | `8001`                          | Bind port                               |
| `app.log_level`                    | `info`                          | Python log level                        |
| `chords.output_format`             | `json`                          | Output format                           |
| `processing.temp_dir`              | `/tmp/chords_generator`         | Temp directory for job files            |
| `processing.cleanup_temp`          | `true`                          | Delete temp files after each request    |
| `storage.backend`                  | `local`                         | `local` or `s3`                         |
| `storage.base_path`                | `./local_bucket`                | Root for local storage (local only)     |
| `storage.bucket`                   | `ultimate_guitar_songs_archive` | S3 bucket name (prod only)              |
| `storage.create_bucket_if_missing` | `false`                         | Auto-create S3 bucket on startup        |
| `aws.region`                       | `us-east-1`                     | AWS region (prod only)                  |
| `aws.use_iam_role`                 | `true`                          | Use IAM role or read creds from secrets |

When `aws.use_iam_role` is `false` and storage backend is `s3`, AWS credentials are read from the project-root `secrets.yml`.

## Testing

```bash
just test-chords-unit   # unit tests, no audio or models
cd chords_generator && APP_ENV=test uv run pytest tests   # everything, incl. a real recognition (needs the models)
```

## Interactive docs

When the server is running, OpenAPI docs are available at:

- Swagger UI: `http://localhost:8001/docs`
- ReDoc: `http://localhost:8001/redoc`
