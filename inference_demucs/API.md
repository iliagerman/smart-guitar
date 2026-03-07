# Inference Demucs API

HTTP API for audio source separation using Demucs `htdemucs_6s` (6-stem model). Accepts a path to an audio file, runs separation, stores the output stems, and returns their locations.

## Running the service

```bash
# Dev (local filesystem storage)
APP_ENV=dev uvicorn inference_demucs.api:app --reload --host 0.0.0.0 --port 8000

# Or via justfile from project root
just run-demucs-api
```

The `APP_ENV` environment variable selects the config profile (`dev` or `prod`). Defaults to `dev`.

## Endpoints

### `GET /health`

Returns service status and the loaded model name.

**Response:**

```json
{
  "status": "ok",
  "model": "htdemucs_6s"
}
```

---

### `POST /separate`

Runs 6-stem audio separation on the given input file.

**Request body:**

| Field        | Type   | Required | Description                                      |
|--------------|--------|----------|--------------------------------------------------|
| `input_path` | string | yes      | Path to the audio file. Local path in dev, S3 key in prod. Must be non-empty. |
| `requested_outputs` | array of strings | no | Which derived outputs to produce. Options: `guitar_isolated`, `vocals_isolated`, `guitar_removed`, `vocals_removed`. Defaults to all four if omitted. The 6 raw stems are always produced regardless. |

Supported input formats: MP3, WAV (any format supported by ffmpeg via Demucs `load_track`).

```json
{
  "input_path": "/path/to/song.mp3",
  "requested_outputs": ["guitar_isolated", "vocals_removed"]
}
```

The model, storage backend, and processing settings are all controlled via server-side configuration (see [Configuration](#configuration)).

**Success response** (`200`):

| Field         | Type             | Description                                           |
|---------------|------------------|-------------------------------------------------------|
| `status`      | string           | Always `"done"`.                                      |
| `output_path` | string           | Directory (local) or S3 prefix where stems are stored.|
| `stems`       | array of objects | List of output stems with name and path.              |
| `input_path`  | string           | Echo of the original input path.                      |

Each entry in `stems`:

| Field  | Type   | Description                                              |
|--------|--------|----------------------------------------------------------|
| `name` | string | Stem identifier derived from the filename (e.g. `guitar`, `vocals`, `drums`, `bass`, `piano`, `other`, `guitar_removed`, `vocals_removed`). |
| `path` | string | Full path to the stem MP3 file in storage.               |

The `stems` array always includes the 6 raw stems (`vocals`, `drums`, `bass`, `guitar`, `piano`, `other`) plus any requested derived outputs (`guitar_removed`, `vocals_removed`). By default all 8 stems are returned.

If all required output files already exist in storage, the endpoint returns them immediately without re-running separation (cached response).

Example:

```json
{
  "status": "done",
  "output_path": "./data/processed/demucs/My Song",
  "stems": [
    { "name": "bass",            "path": "./data/processed/demucs/My Song/bass.mp3" },
    { "name": "drums",           "path": "./data/processed/demucs/My Song/drums.mp3" },
    { "name": "guitar",          "path": "./data/processed/demucs/My Song/guitar.mp3" },
    { "name": "guitar_removed",  "path": "./data/processed/demucs/My Song/guitar_removed.mp3" },
    { "name": "other",           "path": "./data/processed/demucs/My Song/other.mp3" },
    { "name": "piano",           "path": "./data/processed/demucs/My Song/piano.mp3" },
    { "name": "vocals",          "path": "./data/processed/demucs/My Song/vocals.mp3" },
    { "name": "vocals_removed",  "path": "./data/processed/demucs/My Song/vocals_removed.mp3" }
  ],
  "input_path": "/path/to/My Song.mp3"
}
```

**Error responses:**

| Status | Condition                | Body                                          |
|--------|--------------------------|-----------------------------------------------|
| `404`  | Input file not found     | `{"detail": "Input file not found: <path>"}` |
| `422`  | Empty or missing `input_path` | Pydantic validation error                |
| `500`  | Separator or internal error   | `{"detail": "<error message>"}`          |

## Output files

The Demucs `htdemucs_6s` model separates audio into 6 stems. All 6 raw stems plus 2 derived mixes are written to the output directory (8 files total). Raw WAV outputs are automatically converted to MP3 before storage.

| File                | Description                                                  |
|---------------------|--------------------------------------------------------------|
| `drums.mp3`         | Isolated drums stem.                                         |
| `bass.mp3`          | Isolated bass stem.                                          |
| `other.mp3`         | Isolated "other" stem (instruments not in the other categories). |
| `vocals.mp3`        | Isolated vocals stem.                                        |
| `guitar.mp3`        | Isolated guitar stem.                                        |
| `piano.mp3`         | Isolated piano stem.                                         |
| `guitar_removed.mp3`| All stems except guitar mixed together (vocals + drums + bass + piano + other). |
| `vocals_removed.mp3`| All stems except vocals mixed together (guitar + drums + bass + piano + other). |

All outputs are MP3 files converted from 2-channel WAV at the model's native sample rate (44.1 kHz).

The response `stems` array includes all 6 raw stems plus any requested derived outputs (up to 8 total).

**Note:** The model has a single `guitar` stem. All guitar-like signals in the track (acoustic, electric, rhythm, lead) are combined into that one stem. The model does not separate individual guitars from each other.

## Storage

Storage location depends on the environment.

### Dev (local filesystem)

Outputs are written to:

```
inference_demucs/data/processed/demucs/<song_name>/
  drums.mp3
  bass.mp3
  other.mp3
  vocals.mp3
  guitar.mp3
  piano.mp3
  guitar_removed.mp3
  vocals_removed.mp3
```

The `data/` directory is created automatically on startup. `<song_name>` is derived from the input filename without its extension.

### Prod (S3)

Outputs are uploaded to:

```
s3://ultimate_guitar_songs_archive/processed/demucs/<song_name>/
  drums.mp3
  bass.mp3
  other.mp3
  vocals.mp3
  guitar.mp3
  piano.mp3
  guitar_removed.mp3
  vocals_removed.mp3
```

The bucket is auto-created on startup if it doesn't exist (`create_bucket_if_missing: true` in config).

In prod, `input_path` is an S3 key (e.g. `songs/My Song.mp3`). The API downloads it to a temp directory before processing, then uploads results back to S3.

## Configuration

Config files live in `inference_demucs/config/`. The base config is merged with the environment-specific file selected by `APP_ENV`.

| File                | Purpose                    |
|---------------------|----------------------------|
| `base.config.yml`   | Shared defaults            |
| `dev.config.yml`    | Local filesystem storage   |
| `prod.config.yml`   | S3 storage + AWS settings  |

Key config values:

| Path                            | Default                          | Description                          |
|---------------------------------|----------------------------------|--------------------------------------|
| `app.host`                      | `0.0.0.0`                        | Bind address                         |
| `app.port`                      | `8000`                           | Bind port                            |
| `app.log_level`                 | `info`                           | Python log level                     |
| `demucs.model_name`             | `htdemucs_6s`                    | Demucs model to load                 |
| `processing.temp_dir`           | `/tmp/inference_demucs`          | Temp directory for job files         |
| `processing.cleanup_temp`       | `true`                           | Delete temp files after each request |
| `storage.backend`               | `local`                          | `local` or `s3`                      |
| `storage.base_path`             | `./data`                         | Root for local storage (dev only)    |
| `storage.bucket`                | `ultimate_guitar_songs_archive`  | S3 bucket name (prod only)           |
| `storage.output_prefix`         | `processed/demucs`               | Subdirectory/prefix for outputs      |
| `storage.create_bucket_if_missing` | `false`                       | Auto-create S3 bucket on startup     |
| `aws.region`                    | `us-east-1`                      | AWS region (prod only)               |
| `aws.use_iam_role`              | `true`                           | Use IAM role or read creds from secrets |

When `aws.use_iam_role` is `false` and storage backend is `s3`, AWS credentials are read from the project-root `secrets.yml`.

## Usage examples

**Dev - separate a local file:**

```bash
curl -X POST http://localhost:8000/separate \
  -H 'Content-Type: application/json' \
  -d '{"input_path": "/path/to/audio/My Song.mp3"}'
```

Output appears at `inference_demucs/data/processed/demucs/My Song/`.

**Prod - separate a file from S3:**

```bash
curl -X POST http://localhost:8000/separate \
  -H 'Content-Type: application/json' \
  -d '{"input_path": "songs/My Song.mp3"}'
```

Output is uploaded to `s3://ultimate_guitar_songs_archive/processed/demucs/My Song/`.

## Testing

```bash
# Run all tests
cd inference_demucs && uv run pytest tests/ -v

# Or via justfile
just test-demucs-api
```

Tests mock the Demucs model so they run without GPU or model weights. S3 tests use [moto](https://github.com/getmoto/moto) for in-memory S3 simulation.

## Interactive docs

When the server is running, OpenAPI docs are available at:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
