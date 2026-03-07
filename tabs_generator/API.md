# Tabs Generator API

HTTP API for guitar tab transcription using [basic-pitch](https://github.com/spotify/basic-pitch). Accepts a path to an isolated guitar stem audio file, runs note detection, converts MIDI pitches to guitar string/fret positions, and stores a tab timeline (JSON) in the same directory as the input file.

## Prerequisites

No native C/C++ dependencies required (unlike chords_generator). basic-pitch uses TensorFlow Lite which is pure Python.

```bash
just setup-tabs
```

This creates a Python 3.11 venv and installs all dependencies via `uv sync`.

## Running the service

```bash
# Local development
just run-tabs

# Or manually
APP_ENV=local uv run uvicorn tabs_generator.api:app --reload --host 0.0.0.0 --port 8004
```

The `APP_ENV` environment variable selects the config profile (`local` or `prod`). Defaults to `local`.

## Endpoints

### `GET /health`

Returns service status.

**Response:**

```json
{
  "status": "ok",
  "service": "tabs_generator-api"
}
```

---

### `POST /transcribe-tabs`

Runs note detection and tab conversion on the given guitar stem audio file.

**Request body:**

| Field        | Type   | Required | Description                                                                               |
| ------------ | ------ | -------- | ----------------------------------------------------------------------------------------- |
| `input_path` | string | yes      | Path to the guitar stem audio file. Local path in dev, S3 key in prod. Must be non-empty. |

Supported input formats: MP3, WAV (any format supported by soundfile/librosa).

```json
{
  "input_path": "/path/to/guitar.mp3"
}
```

**Success response** (`200`):

| Field         | Type             | Description                                                                              |
| ------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `status`      | string           | Always `"done"`.                                                                         |
| `output_path` | string           | Directory (local) or S3 prefix where outputs are stored.                                 |
| `tuning`      | array of strings | Guitar tuning used for fret assignment. Default: `["E2", "A2", "D3", "G3", "B3", "E4"]`. |
| `notes`       | array of objects | Detected notes with string/fret positions and timing.                                    |
| `input_path`  | string           | Echo of the original input path.                                                         |

Each entry in `notes`:

| Field        | Type  | Description                                       |
| ------------ | ----- | ------------------------------------------------- |
| `start_time` | float | Note start time in seconds.                       |
| `end_time`   | float | Note end time in seconds.                         |
| `string`     | int   | Guitar string, 0-indexed from low E (0=E2, 5=E4). |
| `fret`       | int   | Fret position (0=open string, 1-24).              |
| `midi_pitch` | int   | MIDI note number (e.g. 40=E2, 60=C4).             |
| `confidence` | float | Detection confidence from basic-pitch (0.0-1.0).  |

Example:

```json
{
  "status": "done",
  "output_path": "/path/to/local_bucket/bob_dylan/knocking_on_heavens_door",
  "tuning": ["E2", "A2", "D3", "G3", "B3", "E4"],
  "notes": [
    { "start_time": 0.50, "end_time": 0.82, "string": 3, "fret": 0, "midi_pitch": 55, "confidence": 0.92 },
    { "start_time": 0.83, "end_time": 1.20, "string": 4, "fret": 1, "midi_pitch": 60, "confidence": 0.87 },
    { "start_time": 1.21, "end_time": 1.55, "string": 3, "fret": 2, "midi_pitch": 57, "confidence": 0.94 }
  ],
  "input_path": "/path/to/guitar.mp3"
}
```

**Error responses:**

| Status | Condition                       | Body                                         |
| ------ | ------------------------------- | -------------------------------------------- |
| `404`  | Input file not found            | `{"detail": "Input file not found: <path>"}` |
| `422`  | Empty or missing `input_path`   | Pydantic validation error                    |
| `500`  | Transcription or internal error | `{"detail": "<error message>"}`              |

## Output files

One file is written to the same directory as the input audio file:

| File        | Description                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `tabs.json` | JSON object with `tuning` array and `notes` array of detected notes with string/fret positions. |

Output directory structure (local):

```
local_bucket/
  bob_dylan/
    knocking_on_heavens_door/
      Bob Dylan - Knockin' On Heaven's Door (Official Audio).mp3
      vocals.mp3          # from inference_demucs
      guitar.mp3          # from inference_demucs (input to tabs_generator)
      chords.json         # from chords_generator
      chords.lab          # from chords_generator
      lyrics.json         # from lyrics_generator
      tabs.json           # from tabs_generator
```

## MIDI-to-Tab Conversion

The tab converter assigns detected MIDI pitches to guitar string/fret positions using a greedy algorithm:

1. **Possible positions**: For each MIDI pitch, enumerate all valid `(string, fret)` combos where `fret = pitch - open_string_pitch` and `0 <= fret <= max_fret`.
2. **Greedy selection**: Pick the position closest to the current hand position, with a small bias toward lower frets (more natural playing positions).
3. **Hand tracking**: Maintain a weighted moving average of hand position (`0.7 * current + 0.3 * new`). Open strings (fret 0) don't update the tracker.

Standard tuning MIDI values: E2=40, A2=45, D3=50, G3=55, B3=59, E4=64.

## Storage

Storage location depends on the environment.

### Local (filesystem)

Outputs are written to the parent directory of the input file. No separate output prefix is used.

### Prod (S3)

Outputs are uploaded to the same S3 prefix as the input file:

```
s3://ultimate_guitar_songs_archive/
  song_name/
    guitar.mp3
    tabs.json
```

The bucket is auto-created on startup if `create_bucket_if_missing: true` in config.

In prod, `input_path` is an S3 key. The API downloads it to a temp directory before processing, then uploads results back to S3.

## Configuration

Config files live in `tabs_generator/config/`. The base config is merged with the environment-specific file selected by `APP_ENV`.

| File               | Purpose                          |
| ------------------ | -------------------------------- |
| `base.config.yml`  | Shared defaults                  |
| `local.config.yml` | Local filesystem storage         |
| `test.config.yml`  | Test storage (local_bucket_test) |
| `prod.config.yml`  | S3 storage + AWS settings        |

Key config values:

| Path                               | Default                         | Description                                        |
| ---------------------------------- | ------------------------------- | -------------------------------------------------- |
| `app.host`                         | `0.0.0.0`                       | Bind address                                       |
| `app.port`                         | `8004`                          | Bind port                                          |
| `app.log_level`                    | `info`                          | Python log level                                   |
| `tabs.output_format`               | `json`                          | Output format                                      |
| `tabs.tuning`                      | `[40, 45, 50, 55, 59, 64]`      | Open string MIDI values (standard tuning)          |
| `tabs.max_fret`                    | `24`                            | Maximum fret position                              |
| `tabs.min_confidence`              | `0.5`                           | Minimum note amplitude to include                  |
| `tabs.onset_threshold`             | `0.5`                           | basic-pitch onset sensitivity (lower = more notes) |
| `tabs.frame_threshold`             | `0.3`                           | basic-pitch frame sensitivity                      |
| `processing.temp_dir`              | `/tmp/tabs_generator`           | Temp directory for job files                       |
| `processing.cleanup_temp`          | `true`                          | Delete temp files after each request               |
| `storage.backend`                  | `local`                         | `local` or `s3`                                    |
| `storage.base_path`                | `./local_bucket`                | Root for local storage (local only)                |
| `storage.bucket`                   | `ultimate_guitar_songs_archive` | S3 bucket name (prod only)                         |
| `storage.create_bucket_if_missing` | `false`                         | Auto-create S3 bucket on startup                   |
| `aws.region`                       | `us-east-1`                     | AWS region (prod only)                             |
| `aws.use_iam_role`                 | `true`                          | Use IAM role or read creds from secrets            |

When `aws.use_iam_role` is `false` and storage backend is `s3`, AWS credentials are read from the project-root `secrets.yml`.

## Testing

```bash
# Test suite (ASGITransport-based, no uvicorn)
just test-tabs

# Manual integration test
just run-tabs
curl -s -X POST http://localhost:8004/transcribe-tabs \
    -H 'Content-Type: application/json' \
    -d '{"input_path": "<path-to-guitar-stem.mp3>"}' | python -m json.tool
```

## Interactive docs

When the server is running, OpenAPI docs are available at:

- Swagger UI: `http://localhost:8004/docs`
- ReDoc: `http://localhost:8004/redoc`
