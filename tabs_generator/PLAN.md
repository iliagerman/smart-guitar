# Tabs Generator Service — Implementation Plan

## Context

New standalone microservice that uses Spotify's open-source **basic-pitch** model to transcribe individual guitar notes from an isolated guitar stem with timing information, then converts MIDI note detections to guitar string/fret positions. Mirrors the `chords_generator/` and `lyrics_generator/` architecture exactly: FastAPI app, storage abstraction, YAML config, Dockerfile. Runs on port 8004 via AWS Lambda (container image).

**Multi-guitar handling**: The Demucs guitar stem may contain multiple guitars (lead + rhythm). basic-pitch handles polyphonic audio and will detect notes from all guitars. Configurable confidence thresholds (`min_confidence`, `onset_threshold`, `frame_threshold`) filter noise. Lead/rhythm splitting can be added later as post-processing without API changes.

## Directory Structure

```
tabs_generator/
  PLAN.md
  API.md
  pyproject.toml
  Dockerfile
  config/
    base.config.yml
    local.config.yml
    test.config.yml
    prod.config.yml
  src/tabs_generator/
    __init__.py
    api.py
    config.py
    storage.py
    schemas.py
    transcriber.py
    tab_converter.py
  tests/
    __init__.py
    conftest.py
    test_api.py
    test_tab_converter.py
```

## Files to Create

### `pyproject.toml`

Copy structure from `chords_generator/pyproject.toml`. Key differences:

```toml
[project]
name = "guitar-player-tabs-generator"
description = "Guitar tab transcription service using basic-pitch"
requires-python = ">=3.10"
dependencies = [
    "basic-pitch",
    "numpy>=1.24.0",
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "boto3>=1.35.0",
    "pyyaml>=6.0",
    "pydantic>=2.0.0",
    "mangum>=0.19.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "httpx>=0.27.0",
]

[tool.hatch.build.targets.wheel]
packages = ["src/tabs_generator"]
```

No special `no-build-isolation` or native deps needed (basic-pitch is pure Python with TF-Lite).

### `config.py`

Copy from `chords_generator/src/chords_generator/config.py` (~143 lines). Replace all `chords_generator` references with `tabs_generator`. Add tabs-specific config:

```python
class TabsConfig(BaseModel):
    output_format: str = "json"
    tuning: list[int] = [40, 45, 50, 55, 59, 64]  # Standard guitar E2-E4
    max_fret: int = 24
    min_confidence: float = 0.5
    onset_threshold: float = 0.5
    frame_threshold: float = 0.3
```

Default port: `8004`.

### `storage.py`

Copy directly from `chords_generator/src/chords_generator/storage.py` (~152 lines). Replace imports only. The local/S3 storage abstraction with `resolve_input`, `store_outputs`, `file_exists` is identical.

### `schemas.py`

```python
from dataclasses import dataclass
from pydantic import BaseModel, Field

@dataclass
class NoteResult:
    start_time: float
    end_time: float
    midi_pitch: int
    amplitude: float
    string: int       # 0-indexed from low E
    fret: int
    confidence: float

class TranscribeTabsRequest(BaseModel):
    input_path: str = Field(..., min_length=1)

class TabNote(BaseModel):
    start_time: float
    end_time: float
    string: int
    fret: int
    midi_pitch: int
    confidence: float

class TranscribeTabsResponse(BaseModel):
    status: str = "done"
    output_path: str
    tuning: list[str]   # ["E2", "A2", "D3", "G3", "B3", "E4"]
    notes: list[TabNote]
    input_path: str
```

### `transcriber.py` — Core basic-pitch Wrapper

```python
_model = None

def _get_model():
    global _model
    if _model is None:
        from basic_pitch import ICASSP_2022_MODEL_PATH
        _model = ICASSP_2022_MODEL_PATH
    return _model

def transcribe_notes(audio_path, output_dir, onset_threshold=0.5, frame_threshold=0.3, min_confidence=0.5):
    from basic_pitch.inference import predict

    model_path = _get_model()
    model_output, midi_data, note_events = predict(
        audio_path,
        model_or_model_path=model_path,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
    )

    results = []
    for event in note_events:
        start_time, end_time, midi_pitch, amplitude = float(event[0]), float(event[1]), int(event[2]), float(event[3])
        if amplitude < min_confidence:
            continue
        results.append(NoteResult(
            start_time=round(start_time, 3), end_time=round(end_time, 3),
            midi_pitch=midi_pitch, amplitude=round(amplitude, 3),
            string=-1, fret=-1, confidence=round(amplitude, 3),
        ))

    results.sort(key=lambda n: n.start_time)
    return results
```

Use dataclasses (`NoteResult`) internally, matching the `chords_generator/recognizer.py` pattern.

### `tab_converter.py` — MIDI-to-Tab Conversion

Greedy algorithm for assigning MIDI pitches to guitar string/fret positions:

```python
STANDARD_TUNING = [40, 45, 50, 55, 59, 64]  # E2, A2, D3, G3, B3, E4
TUNING_NAMES = ["E2", "A2", "D3", "G3", "B3", "E4"]
MAX_FRET = 24

def get_possible_positions(midi_pitch, tuning=None, max_fret=MAX_FRET):
    """Return all (string, fret) that can produce a given MIDI pitch."""
    ...

def assign_fret_positions(notes, tuning=None, max_fret=MAX_FRET):
    """Assign optimal string/fret to each note using greedy hand-position tracking."""
    # For each note: pick position closest to current hand, with small bias toward lower frets
    # Track hand position with weighted moving average (0.7 * current + 0.3 * new)
    ...

def convert_to_tabs(notes, output_dir, tuning=None, max_fret=MAX_FRET):
    """Full pipeline: assign positions and write tabs.json."""
    ...
```

### `api.py` — FastAPI Application

Follow `chords_generator/src/chords_generator/api.py` pattern exactly:

- **Lifespan**: Initialize storage backend at startup
- **`GET /health`**: Returns `{"status": "ok", "service": "tabs_generator-api"}`
- **`POST /transcribe-tabs`**: Accepts `TranscribeTabsRequest`, creates temp job dir, resolves input via storage, runs `transcribe_notes()` + `convert_to_tabs()`, stores outputs alongside input, returns `TranscribeTabsResponse`
- **Error handling**: 404 if input not found, 500 with detail on failure, cleanup temp dir in `finally`
- **`handler = Mangum(app)`** at bottom for Lambda deployment

### Config Files

**`config/base.config.yml`**:
```yaml
app:
  name: "tabs_generator-api"
  host: "0.0.0.0"
  port: 8004
  log_level: "info"

tabs:
  output_format: "json"
  tuning: [40, 45, 50, 55, 59, 64]
  max_fret: 24
  min_confidence: 0.5
  onset_threshold: 0.5
  frame_threshold: 0.3

processing:
  temp_dir: "/tmp/tabs_generator"
  cleanup_temp: true

storage:
```

**`config/local.config.yml`**:
```yaml
environment: "local"
storage:
  backend: "local"
  base_path: "./local_bucket"
```

**`config/test.config.yml`**:
```yaml
environment: "test"
storage:
  backend: "local"
  base_path: "../local_bucket_test"
```

**`config/prod.config.yml`**:
```yaml
environment: "prod"
aws:
  region: "us-east-1"
  use_iam_role: true
storage:
  backend: "s3"
  bucket: "ultimate_guitar_songs_archive"
```

### `Dockerfile`

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY config/ ./config/
COPY src/ ./src/

# Pre-download basic-pitch model at build time
RUN uv run python -c "from basic_pitch import ICASSP_2022_MODEL_PATH; print(ICASSP_2022_MODEL_PATH)"

ENV APP_ENV=prod
EXPOSE 8004
CMD ["uv", "run", "uvicorn", "tabs_generator.api:app", "--host", "0.0.0.0", "--port", "8004"]
```

### Output Format (`tabs.json`)

```json
{
  "tuning": ["E2", "A2", "D3", "G3", "B3", "E4"],
  "notes": [
    {
      "start_time": 0.5,
      "end_time": 0.8,
      "string": 5,
      "fret": 3,
      "midi_pitch": 55,
      "confidence": 0.92
    }
  ]
}
```

## Tests

### `tests/conftest.py`

- ASGI transport client fixture (same pattern as `lyrics_generator/tests/conftest.py`)
- Test storage pointing at `../local_bucket_test`
- Skip if test guitar stem not found

### `tests/test_tab_converter.py` — Unit Tests (no model, fast)

| Test | Description |
|------|-------------|
| `test_get_possible_positions_open_e` | MIDI 40 → (string 0, fret 0) |
| `test_get_possible_positions_middle_c` | MIDI 60 → multiple positions |
| `test_get_possible_positions_out_of_range` | MIDI 30 → empty list |
| `test_assign_prefers_lower_frets` | From fret 0, picks lowest valid position |
| `test_assign_tracks_hand_position` | Sequential notes track hand movement |
| `test_assign_open_strings_dont_move_hand` | Fret 0 doesn't shift hand tracker |
| `test_convert_to_tabs_writes_json` | Full pipeline writes valid tabs.json |
| `test_convert_empty_notes` | Empty list → valid empty output |

### `tests/test_api.py` — Integration Tests (requires model)

| Test | Description |
|------|-------------|
| `test_health` | `GET /health` → 200 |
| `test_transcribe_tabs` | Real guitar stem → 200, valid notes, tabs.json written |
| `test_transcribe_tabs_not_found` | Missing file → 404 |
| `test_transcribe_tabs_empty_path` | Empty string → 422 |

## Key References (files to copy from)

- `chords_generator/src/chords_generator/api.py` — API structure
- `chords_generator/src/chords_generator/config.py` — Config loader
- `chords_generator/src/chords_generator/storage.py` — Storage abstraction
- `chords_generator/src/chords_generator/recognizer.py` — Core processing pattern
- `chords_generator/src/chords_generator/schemas.py` — Schema pattern
- `chords_generator/pyproject.toml` — Project config
- `chords_generator/Dockerfile` — Docker build pattern
- `chords_generator/config/` — All config files
- `lyrics_generator/tests/conftest.py` — ASGI test client pattern
- `lyrics_generator/tests/test_api.py` — Integration test pattern

## Verification

1. `uv sync --python 3.11` in `tabs_generator/`
2. `APP_ENV=local uv run uvicorn tabs_generator.api:app --port 8004`
3. `curl http://localhost:8004/health` — returns OK
4. `curl -X POST http://localhost:8004/transcribe-tabs -H 'Content-Type: application/json' -d '{"input_path": "<path-to-guitar.mp3>"}'` — returns notes with timing + string/fret positions
5. Verify `tabs.json` was created alongside the input file
6. `APP_ENV=test uv run pytest tests/ -v` — all tests pass (unit + integration)
