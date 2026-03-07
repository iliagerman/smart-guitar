# Backend Plan: Tabs Generator Integration

## Context

Integrate the new `tabs_generator` microservice (port 8004) into the backend. The backend needs to: call the tabs service during job processing, store the `tabs_key` on the Song model, serve tab data in the song detail API response, and admin-heal missing tabs from existing files on disk.

---

## 1. Song Model — add `tabs_key`

**File**: `backend/src/guitar_player/models/song.py` (line 34)

Add after `lyrics_key`:

```python
tabs_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
```

---

## 2. Alembic Migration

Run: `just db-revision "add tabs_key to songs"`

Down revision: `8c3433556813` (add_cascade_delete_to_favorites)

```python
def upgrade() -> None:
    op.add_column("songs", sa.Column("tabs_key", sa.String(length=500), nullable=True))

def downgrade() -> None:
    op.drop_column("songs", "tabs_key")
```

---

## 3. Backend Config

**File**: `backend/src/guitar_player/config.py` — `ServicesConfig` class

Add:
```python
tabs_generator: str = "localhost:8004"
```

**File**: `backend/config/base.config.yml` — `services:` section

Add:
```yaml
tabs_generator: "localhost:8004"
```

---

## 4. ProcessingService — add `generate_tabs()`

**File**: `backend/src/guitar_player/services/processing_service.py`

### 4a. New dataclasses (after `LyricsResult`, line 59):

```python
@dataclass
class TabNoteInfo:
    start_time: float
    end_time: float
    string: int
    fret: int
    midi_pitch: int
    confidence: float

@dataclass
class TabsResult:
    tuning: list[str]
    notes: list[TabNoteInfo]
    output_path: str
```

### 4b. Update `__init__` (after line 66):

```python
self._tabs_host = settings.services.tabs_generator
```

### 4c. New method (after `transcribe_lyrics`):

```python
async def generate_tabs(self, input_path: str) -> TabsResult:
    """POST to tabs_generator /transcribe-tabs endpoint."""
    url = f"http://{self._tabs_host}/transcribe-tabs"
    logger.info("Requesting tab generation: %s", input_path)

    async with httpx.AsyncClient(timeout=PROCESSING_TIMEOUT) as client:
        resp = await client.post(url, json={"input_path": input_path})
        resp.raise_for_status()
        data = resp.json()

    notes = [TabNoteInfo(**n) for n in data.get("notes", [])]
    return TabsResult(
        tuning=data.get("tuning", []),
        notes=notes,
        output_path=data.get("output_path", ""),
    )
```

---

## 5. JobService — wire tabs into `_process_job`

**File**: `backend/src/guitar_player/services/job_service.py`

### 5a. Tab generation step in `_process_job` (after chords result, ~line 803):

Non-fatal — same pattern as lyrics transcription:

```python
# Generate tabs from the guitar stem (non-fatal if it fails)
await _set_progress(job_id, 82, "generating_tabs")
guitar_stem_key = f"{song_name}/guitar.mp3"
try:
    if storage.file_exists(guitar_stem_key):
        guitar_path = storage.get_url(guitar_stem_key)
        logger.info("Starting tab generation for job %s using %s", job_id, guitar_stem_key)
        await processing.generate_tabs(guitar_path)
        logger.info("Tab generation finished for job %s", job_id)
    else:
        logger.warning(
            "Skipping tab generation for job %s: guitar stem not found at %s",
            job_id, guitar_stem_key,
        )
except Exception as e:
    logger.warning("Tab generation failed for job %s (non-fatal): %s", job_id, e)
```

### 5b. Persist `tabs_key` in save section (~line 876):

```python
tabs_key = f"{song_name}/tabs.json"
if storage.file_exists(tabs_key):
    song.tabs_key = tabs_key
```

### 5c. Admin healing in `trigger_reprocess` (~line 280):

Add after the lyrics admin block:

```python
# Tabs
tabs_ok = bool(song.tabs_key) and self._storage.file_exists(song.tabs_key)
if not tabs_ok:
    tabs_candidate = f"{song.song_name}/tabs.json"
    if self._storage.file_exists(tabs_candidate):
        song.tabs_key = tabs_candidate
        fixed += 1
```

### 5d. Health check in `_processing_services_healthy` (line 1044):

Add to `urls` dict:

```python
"tabs": f"http://{settings.services.tabs_generator}/health",
```

---

## 6. Song Schemas — add `TabNote`

**File**: `backend/src/guitar_player/schemas/song.py`

### 6a. New model (after `LyricsSegment`, line 82):

```python
class TabNote(BaseModel):
    start_time: float
    end_time: float
    string: int
    fret: int
    midi_pitch: int
    confidence: float
```

### 6b. Update `SongDetailResponse` (line 93):

Add field:
```python
tabs: list[TabNote] = []
```

---

## 7. SongService — serve tabs in `get_song_detail`

**File**: `backend/src/guitar_player/services/song_service.py`

### 7a. Add import (line 15-27):

```python
from guitar_player.schemas.song import (
    ...,
    TabNote,
)
```

### 7b. Read tabs from storage (after lyrics block, ~line 451):

```python
# Read tabs from DB-stored path
tabs: list[TabNote] = []
if song.tabs_key and self._storage.file_exists(song.tabs_key):
    try:
        raw = self._storage.read_json(song.tabs_key)
        if isinstance(raw, dict) and "notes" in raw:
            tabs = [TabNote(**n) for n in raw["notes"]]
    except Exception as e:
        logger.warning("Failed to read tabs for %s: %s", song.song_name, e)
```

### 7c. Add to response constructor (~line 453):

```python
return SongDetailResponse(
    ...,
    tabs=tabs,
)
```

---

## 8. Tests

### 8a. `backend/tests/conftest.py` — add `tabs_server` fixture

Same pattern as `chords_server` and `lyrics_server`:

```python
@pytest.fixture(scope="session")
def tabs_server(project_root: Path):
    """Start the tabs generator server for the test session."""
    print("\n[fixture] Starting tabs server on :8004 ...", flush=True)
    _kill_port(8004)
    proc = subprocess.Popen(
        ["uv", "run", "uvicorn", "--app-dir", "src",
         "tabs_generator.api:app", "--host", "0.0.0.0", "--port", "8004"],
        cwd=project_root / "tabs_generator",
        env={**os.environ, "APP_ENV": "test", "PYTHONPATH": "src"},
        stdout=sys.stdout, stderr=sys.stderr,
    )
    try:
        _wait_for_health("http://localhost:8004/health", "tabs", proc)
        yield proc
    finally:
        print("\n[fixture] Stopping tabs server ...", flush=True)
        proc.terminate()
        proc.wait(timeout=10)
        print("[fixture] Tabs server stopped.", flush=True)
```

### 8b. `backend/tests/test_jobs_stems_and_lyrics.py` — extend

- Add `tabs_server` to fixture params
- Add `tabs.json` to expected output files:
  ```python
  tabs_path = song_dir / "tabs.json"
  generated_files.append(tabs_path)
  assert tabs_path.is_file(), f"Expected output missing: {tabs_path}"
  ```
- Add DB key assertion:
  ```python
  assert db_song.tabs_key and storage.file_exists(db_song.tabs_key)
  ```
- Add `tabs.json` to cleanup in `finally` block

### 8c. `backend/tests/test_song_detail_tabs.py` — new test file

| Test | Description |
|------|-------------|
| `test_song_detail_includes_tabs` | Song with `tabs_key` → detail response contains `tabs` array |
| `test_song_detail_empty_tabs_when_missing` | Song without `tabs_key` → `tabs` is `[]` |
| `test_song_detail_tabs_structure` | Each tab note has correct fields and value ranges |

---

## Files to Modify

| File | Change |
|------|--------|
| `models/song.py` | Add `tabs_key` column |
| `config.py` | Add `tabs_generator` to `ServicesConfig` |
| `config/base.config.yml` | Add `tabs_generator` host |
| `services/processing_service.py` | Add `TabNoteInfo`, `TabsResult`, `generate_tabs()` |
| `services/job_service.py` | Wire tabs into pipeline, admin heal, health check |
| `schemas/song.py` | Add `TabNote`, update `SongDetailResponse` |
| `services/song_service.py` | Serve tabs in `get_song_detail` |
| `tests/conftest.py` | Add `tabs_server` fixture |
| `tests/test_jobs_stems_and_lyrics.py` | Verify tabs.json + tabs_key |
| New: `tests/test_song_detail_tabs.py` | Song detail tabs tests |
| New: alembic migration | Add tabs_key column |
| `API.md` | Document tabs in SongDetailResponse (already done) |

---

## Verification

1. `just db-migrate` — apply migration, verify `tabs_key` column exists
2. `cd backend && APP_ENV=test uv run pytest tests/test_song_detail_tabs.py -v -s` — tabs in song detail
3. `just dev` — start all services including tabs on :8004
4. Process a song end-to-end, verify `tabs.json` appears in song directory
5. `curl http://localhost:8002/api/v1/songs/{id}` — verify response includes `tabs` array
6. `cd backend && APP_ENV=test uv run pytest tests/test_jobs_stems_and_lyrics.py -v -s` — full pipeline including tabs
