# Chords Generator API

HTTP API for chord recognition using [autochord](https://github.com/urinieto/autochord). Accepts a path to an audio file, runs chord detection, and stores a chord timeline (JSON + LAB) in the same directory as the input file.

## Prerequisites (macOS Apple Silicon)

The `autochord` library depends on `vamp` (C extension) and the `nnls-chroma` VAMP plugin. Both require native arm64 builds on Apple Silicon.

### 1. Install system dependencies

```bash
brew install vamp-plugin-sdk boost
```

### 2. Build the nnls-chroma VAMP plugin

The plugin bundled with `autochord` is a Linux ELF binary. You must build a native macOS `.dylib` from source:

```bash
cd /tmp
git clone https://github.com/c4dm/nnls-chroma.git
cd nnls-chroma

CXXFLAGS="-arch arm64 -O3 -ffast-math \
  -I/opt/homebrew/opt/vamp-plugin-sdk/include \
  -I/opt/homebrew/include \
  -Wall -fPIC -stdlib=libc++ \
  -I$(xcrun --show-sdk-path)/usr/include/c++/v1" \
CFLAGS="-arch arm64 -O3 -ffast-math \
  -I/opt/homebrew/opt/vamp-plugin-sdk/include \
  -Wall -fPIC" \
make -f Makefile.osx \
  VAMP_SDK_DIR=/opt/homebrew/opt/vamp-plugin-sdk/include \
  BOOST_ROOT=/opt/homebrew/include \
  ARCHFLAGS="" \
  OPTFLAGS="" \
  LDFLAGS="-arch arm64 -dynamiclib -install_name nnls-chroma.dylib \
    /opt/homebrew/opt/vamp-plugin-sdk/lib/libvamp-sdk.a \
    -exported_symbols_list vamp-plugin.list -framework Accelerate"
```

Install the built plugin:

```bash
mkdir -p ~/Library/Audio/Plug-Ins/Vamp
cp nnls-chroma.dylib nnls-chroma.cat nnls-chroma.n3 ~/Library/Audio/Plug-Ins/Vamp/
```

### 3. Install Python dependencies

```bash
just setup-chords
```

This creates a Python 3.11 venv, pre-installs numpy+setuptools (needed by `vamp` at build time), sets `CPLUS_INCLUDE_PATH` and `ARCHFLAGS` for native arm64 compilation, then runs `uv sync`.

### Known dependency issues

| Issue                                         | Cause                                           | Fix                                                                                                     |
| --------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `vamp` build fails: `'string' file not found` | Missing C++ headers on macOS                    | `export CPLUS_INCLUDE_PATH="$(xcrun --show-sdk-path)/usr/include/c++/v1"` (done by `just setup-chords`) |
| `vamp` compiles as x86_64                     | Cached wheel or wrong arch flags                | `ARCHFLAGS="-arch arm64"` (done by `just setup-chords`)                                                 |
| `No module named 'pkg_resources'`             | setuptools >= 82 removed it                     | `setuptools<81` pinned in pyproject.toml                                                                |
| Keras 3 can't load autochord model            | TF 2.16+ ships Keras 3, autochord needs Keras 2 | `tf-keras` in dependencies + `TF_USE_LEGACY_KERAS=1` env var (set by all just recipes)                  |
| `nnls-chroma` plugin not found                | Bundled `.so` is Linux ELF                      | Build from source (see above)                                                                           |

## Running the service

```bash
# Local development
just run-chords

# Or manually
TF_USE_LEGACY_KERAS=1 APP_ENV=local uv run uvicorn chords_generator.api:app --reload --host 0.0.0.0 --port 8001
```

The `APP_ENV` environment variable selects the config profile (`local` or `prod`). Defaults to `local`.

`TF_USE_LEGACY_KERAS=1` is required to force TensorFlow to use Keras 2 (via `tf-keras`) instead of Keras 3, which is incompatible with autochord's saved model format.

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

| Field        | Type   | Required | Description                                                                   |
| ------------ | ------ | -------- | ----------------------------------------------------------------------------- |
| `input_path` | string | yes      | Path to the audio file. Local path in dev, S3 key in prod. Must be non-empty. |

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
| `chord`      | string | Chord label in MIREX format (e.g. `G:maj`, `A:min`, `N` for no chord). |

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

Two files are written to the same directory as the input audio file:

| File          | Description                                                          |
| ------------- | -------------------------------------------------------------------- |
| `chords.json` | JSON array of chord segments with `start_time`, `end_time`, `chord`. |
| `chords.lab`  | MIREX LAB format (tab-separated: `start_time end_time chord`).       |

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
# Integration test (starts server, sends request, cleans output)
just test-chords

# Integration test (keeps chords.json and chords.lab for inspection)
just test-chords cleanup=false

# With a custom audio file
just test-chords /path/to/audio.mp3 cleanup=false
```

There are no unit tests for chords_generator. Testing is done via integration tests that start the API server, send a real recognition request, and verify the output.

## Interactive docs

When the server is running, OpenAPI docs are available at:

- Swagger UI: `http://localhost:8001/docs`
- ReDoc: `http://localhost:8001/redoc`
