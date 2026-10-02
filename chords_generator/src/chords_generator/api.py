"""FastAPI application wrapping chord recognition.

Provides /health and /recognize endpoints. Storage backend (local or S3)
is selected via config, initialized on startup.
"""

import json
import logging
import os
import shutil
import subprocess
import sys
import uuid
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, HTTPException
from mangum import Mangum
from pythonjsonlogger.json import JsonFormatter

from chords_generator.bass_detect import detect_bass_for_chords
from chords_generator.beat_align import snap_chords_to_beats
from chords_generator.beat_tracking import track_file_beats
from chords_generator.config import get_settings
from chords_generator.mixing import mix_audio_files
from chords_generator.observability import instrument_runtime_observer
from chords_generator.chord_model import LABELS
from chords_generator.recognizer import CHORD_PROBS_FILE, beat_meta, recognize_chords, write_chord_files
from chords_generator.sheet_align import best_alignment
from chords_generator.request_context import RequestContextFilter, RequestContextMiddleware
from chords_generator.simplifier import generate_simplified_options, write_simplified_outputs
from chords_generator.schemas import (
    AlignRequest,
    AlignResponse,
    ChordInfo,
    ChordResult,
    DetectBassRequest,
    DetectBassResponse,
    EnhanceRequest,
    EnhanceResponse,
    PracticeAudioRequest,
    PracticeAudioResponse,
    RecognizeRequest,
    RecognizeResponse,
)
from chords_generator.storage import StorageBackend, create_storage
from chords_generator.strum_accents import detect_strum_accents

logger = logging.getLogger(__name__)

_storage: StorageBackend


def _setup_logging(level: str = "INFO", service_name: str = "chords-generator") -> None:
    """Configure JSON structured logging for CloudWatch."""
    handler = logging.StreamHandler(sys.stdout)
    formatter = JsonFormatter(
        fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
        rename_fields={"asctime": "timestamp", "levelname": "level", "name": "logger"},
        static_fields={"service": service_name},
    )
    handler.setFormatter(formatter)
    handler.addFilter(RequestContextFilter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _storage
    settings = get_settings()

    _setup_logging(level=settings.app.log_level)

    _storage = create_storage(settings)
    _storage.init()
    logger.info(
        "API started: env=%s, storage=%s",
        settings.environment,
        settings.storage.backend,
    )

    yield


app = FastAPI(title="Chords Generator API", lifespan=lifespan)
instrument_runtime_observer(app, service_name="chords-generator")
app.add_middleware(RequestContextMiddleware)


# Fields chord recognition owns in chord_meta.json; anything else (capo, key)
# was written by another pipeline and is kept.
_BEAT_META_FIELDS = (
    "bpm", "beat_times", "downbeat_times", "beats_per_bar", "bar_starts", "chord_model", "beat_model",
)


def _read_existing_meta(song_file_path: str) -> dict:
    meta_key = os.path.join(os.path.dirname(song_file_path), "chord_meta.json")
    if not _storage.file_exists(meta_key):
        return {}
    try:
        with open(_storage.resolve_input(meta_key)) as f:
            existing = json.load(f)
    except Exception:
        logger.warning("Unreadable chord_meta.json at %s — rewriting", meta_key)
        return {}
    return existing if isinstance(existing, dict) else {}


def _merge_existing_meta(meta_path: str, song_file_path: str) -> None:
    """Keep the song's other chord_meta.json fields around the freshly written beat fields."""
    with open(meta_path) as f:
        fresh = json.load(f)
    kept = {k: v for k, v in _read_existing_meta(song_file_path).items() if k not in _BEAT_META_FIELDS}
    with open(meta_path, "w") as f:
        json.dump({**kept, **fresh}, f, indent=2)


@app.get("/health")
def health():
    return {"status": "ok", "service": "chords_generator-api"}


@app.post("/recognize", response_model=RecognizeResponse)
def recognize(request: RecognizeRequest):
    settings = get_settings()
    temp_dir = settings.processing.temp_dir
    job_id = str(uuid.uuid4())
    job_dir = os.path.join(temp_dir, job_id)
    output_dir = os.path.join(job_dir, "output")

    os.makedirs(output_dir, exist_ok=True)

    try:
        # Check file exists
        if not _storage.file_exists(request.input_path):
            raise HTTPException(status_code=404, detail=f"Input file not found: {request.input_path}")

        # Get local path (no-op for local storage, download for S3)
        local_input = _storage.resolve_input(request.input_path)

        # The chord model also hears the accompaniment mix (bass/guitar/piano/
        # other, no vocals or drums) when those stems already exist; beats
        # always come from the full mix.
        accompaniment_path = None
        existing_stem_paths = [
            p for p in request.accompaniment_stem_paths if _storage.file_exists(p)
        ]
        if existing_stem_paths:
            accompaniment_path = os.path.join(job_dir, "accompaniment.wav")
            try:
                mix_audio_files(
                    [_storage.resolve_input(p) for p in existing_stem_paths], accompaniment_path,
                )
                logger.info(
                    "Recognizing chords with the accompaniment mix (%d stems)",
                    len(existing_stem_paths),
                    extra={"job_id": job_id, "event_type": "recognition_accompaniment_mix"},
                )
            except ValueError:
                # Stems that don't line up (another sample rate) still leave
                # the full mix to recognize.
                logger.warning("Stems can't be mixed; recognizing the full mix only", exc_info=True)
                accompaniment_path = None

        logger.info("Starting chord recognition", extra={"job_id": job_id, "input_path": request.input_path, "event_type": "recognition_start"})
        results = recognize_chords(local_input, output_dir, accompaniment_path)
        _merge_existing_meta(os.path.join(output_dir, "chord_meta.json"), request.input_path)

        # Store outputs alongside the input file (same song directory)
        output_path = _storage.store_outputs(output_dir, request.input_path)

        # Build chord list from recognition results
        chords = [
            ChordInfo(start_time=r.start_time, end_time=r.end_time, chord=r.chord)
            for r in results
        ]

        return RecognizeResponse(
            status="done",
            output_path=output_path,
            chords=chords,
            input_path=request.input_path,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Chord recognition failed", extra={"job_id": job_id, "event_type": "recognition_failed"})
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        _storage.release_inputs()
        if settings.processing.cleanup_temp and os.path.exists(job_dir):
            shutil.rmtree(job_dir, ignore_errors=True)
            logger.info("Cleaned up temp dir: %s", job_dir)


@app.post("/align", response_model=AlignResponse)
def align(request: AlignRequest):
    """Line the song's community chord sheet up with its recognized beats and chords.

    Reads chord_probs.npz and chord_meta.json beside chords_path (written by
    /recognize). When a sheet version fits the audio, chords.json and the
    simplified variants are rewritten with the sheet's chord names on the
    detected timing; otherwise they are left as detected. chord_meta.json
    records the outcome either way.
    """
    settings = get_settings()
    job_dir = os.path.join(settings.processing.temp_dir, str(uuid.uuid4()))
    os.makedirs(job_dir, exist_ok=True)
    folder = os.path.dirname(request.chords_path)
    probs_path = os.path.join(folder, CHORD_PROBS_FILE)
    meta_path = os.path.join(folder, "chord_meta.json")
    try:
        for path in (request.sheet_path, probs_path, meta_path):
            if not _storage.file_exists(path):
                raise HTTPException(status_code=404, detail=f"Not found: {path}")
        with np.load(_storage.resolve_input(probs_path)) as stored:
            log_probs = stored["log_probs"].astype(np.float64)
            frame_s = float(stored["frame_s"])
        with open(_storage.resolve_input(meta_path)) as f:
            meta = json.load(f)
        with open(_storage.resolve_input(request.sheet_path)) as f:
            versions = (json.load(f) or {}).get("versions") or []

        best = best_alignment(log_probs, frame_s, meta, versions, LABELS)
        for key in ("chord_source", "sheet_url", "sheet_transpose", "sheet_loss_per_beat"):
            meta.pop(key, None)
        response = AlignResponse(accepted=False)
        if best:
            alignment, version = best
            meta.update(
                sheet_url=version.get("source_url") or None,
                sheet_transpose=alignment.transpose,
                sheet_loss_per_beat=round(alignment.loss_per_beat, 3),
            )
            response = AlignResponse(
                accepted=alignment.accepted, loss_per_beat=round(alignment.loss_per_beat, 3),
                transpose=alignment.transpose, source_url=version.get("source_url") or None,
            )
        if best and best[0].accepted:
            alignment, version = best
            meta["chord_source"] = "sheet"
            capo = int(version.get("capo") or 0)
            if capo and alignment.transpose == capo:
                meta["capo"] = capo
            write_chord_files(alignment.chords, job_dir)
            # Capo variants the previous chords had but these don't.
            for n in range(1, 12):
                name = f"chords_beginner_capo_{n}.json"
                if not os.path.exists(os.path.join(job_dir, name)):
                    _storage.delete(os.path.join(folder, name))
            response.chords = [
                ChordInfo(start_time=c.start_time, end_time=c.end_time, chord=c.chord, bass=c.bass)
                for c in alignment.chords
            ]
        else:
            meta["chord_source"] = "detected"
        with open(os.path.join(job_dir, "chord_meta.json"), "w") as f:
            json.dump(meta, f, indent=2)
        _storage.store_outputs(job_dir, request.chords_path)
        logger.info(
            "Align: accepted=%s loss=%s transpose=%s %s",
            response.accepted, response.loss_per_beat, response.transpose, request.chords_path,
            extra={"event_type": "align_done"},
        )
        return response
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Align failed", extra={"event_type": "align_failed"})
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        _storage.release_inputs()
        if settings.processing.cleanup_temp and os.path.exists(job_dir):
            shutil.rmtree(job_dir, ignore_errors=True)


# Stems whose strokes carry the strumming accents: strummed and picked parts.
ACCENT_STEMS = ("guitar", "other")
MIXER_DIR = "mixer"
# LAME VBR quality for the mixer copies (~130 kbps): a third the size of the
# 192 kbps CBR stems. The player decodes these whole, so VBR timing is exact;
# the CBR originals stay for single-track streaming, where it isn't.
MIXER_VBR_QUALITY = "5"


@app.post("/practice-audio", response_model=PracticeAudioResponse)
def practice_audio(request: PracticeAudioRequest):
    """Lighter stem copies for the multi-stem player, and the strum accents.

    Writes mixer/<stem>.mp3 beside chords_path for each given stem, and
    strum_accents.json measured on the guitar and "other" stems at the beats
    in chord_meta.json.
    """
    settings = get_settings()
    job_dir = os.path.join(settings.processing.temp_dir, str(uuid.uuid4()))
    mixer_dir = os.path.join(job_dir, MIXER_DIR)
    os.makedirs(mixer_dir, exist_ok=True)
    folder = os.path.dirname(request.chords_path)
    meta_path = os.path.join(folder, "chord_meta.json")
    try:
        for path in (meta_path, *request.stems.values()):
            if not _storage.file_exists(path):
                raise HTTPException(status_code=404, detail=f"Not found: {path}")
        with open(_storage.resolve_input(meta_path)) as f:
            meta = json.load(f)
        local_stems = {name: _storage.resolve_input(path) for name, path in request.stems.items()}

        for name, local in local_stems.items():
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-i", local, "-codec:a", "libmp3lame",
                 "-q:a", MIXER_VBR_QUALITY, os.path.join(mixer_dir, f"{name}.mp3")],
                check=True,
            )
        _storage.store_outputs(mixer_dir, os.path.join(folder, MIXER_DIR, "stems"))

        accent_paths = [local_stems[name] for name in ACCENT_STEMS if name in local_stems]
        accents = None
        if accent_paths and meta.get("beat_times") and meta.get("downbeat_times"):
            accents = detect_strum_accents(
                accent_paths, meta["beat_times"], meta["downbeat_times"], int(meta.get("beats_per_bar") or 4),
            )
        if accents:
            with open(os.path.join(job_dir, "strum_accents.json"), "w") as f:
                json.dump(accents.to_json(), f, indent=2)
            _storage.store_outputs(job_dir, request.chords_path)
        logger.info(
            "Practice audio: %d mixer stems, accents=%s %s",
            len(local_stems), accents.accents if accents else None, request.chords_path,
            extra={"event_type": "practice_audio_done"},
        )
        return PracticeAudioResponse(mixer_stems=sorted(local_stems), accents=accents.accents if accents else None)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Practice audio failed", extra={"event_type": "practice_audio_failed"})
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        _storage.release_inputs()
        if settings.processing.cleanup_temp and os.path.exists(job_dir):
            shutil.rmtree(job_dir, ignore_errors=True)


@app.post("/detect-bass", response_model=DetectBassResponse)
def detect_bass(request: DetectBassRequest):
    """Annotate an existing chords.json with slash bass notes from the bass stem.

    Reads the chords file and bass stem, estimates the sounding bass note per
    chord, writes the annotated chords.json back in place, and returns it.
    """
    settings = get_settings()
    job_dir = os.path.join(settings.processing.temp_dir, str(uuid.uuid4()))
    os.makedirs(job_dir, exist_ok=True)
    try:
        if not _storage.file_exists(request.bass_path):
            raise HTTPException(status_code=404, detail=f"Bass stem not found: {request.bass_path}")
        if not _storage.file_exists(request.chords_path):
            raise HTTPException(status_code=404, detail=f"Chords not found: {request.chords_path}")

        local_bass = _storage.resolve_input(request.bass_path)
        local_chords = _storage.resolve_input(request.chords_path)
        with open(local_chords) as f:
            raw = json.load(f)

        chord_results = [
            ChordResult(
                start_time=c["start_time"], end_time=c["end_time"],
                chord=c["chord"], bass=c.get("bass"),
            )
            for c in raw
        ]
        annotated = detect_bass_for_chords(local_bass, chord_results)

        out_path = os.path.join(job_dir, "chords.json")
        with open(out_path, "w") as f:
            json.dump(
                [
                    {
                        "start_time": c.start_time, "end_time": c.end_time,
                        "chord": c.chord, "bass": c.bass,
                    }
                    for c in annotated
                ],
                f, indent=2,
            )
        _storage.store_outputs(job_dir, request.chords_path)

        chords = [
            ChordInfo(start_time=c.start_time, end_time=c.end_time, chord=c.chord, bass=c.bass)
            for c in annotated
        ]
        logger.info(
            "Bass detection done: %d chords (%d with slash bass)",
            len(chords), sum(1 for c in chords if c.bass),
            extra={"event_type": "detect_bass_done", "chords_path": request.chords_path},
        )
        return DetectBassResponse(chords=chords, chords_path=request.chords_path)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Bass detection failed", extra={"event_type": "detect_bass_failed"})
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        _storage.release_inputs()
        if settings.processing.cleanup_temp and os.path.exists(job_dir):
            shutil.rmtree(job_dir, ignore_errors=True)


@app.post("/enhance", response_model=EnhanceResponse)
def enhance(request: EnhanceRequest):
    """Enhance an existing chords.json in place: snap chord changes to the
    detected beat grid and (if a bass stem is given) add slash bass notes.

    Operates on the already-recognized chords — it does NOT re-run chord
    recognition or demucs — so it's a cheap way to back-fill beat alignment +
    slash bass.
    """
    settings = get_settings()
    job_dir = os.path.join(settings.processing.temp_dir, str(uuid.uuid4()))
    os.makedirs(job_dir, exist_ok=True)
    try:
        if not _storage.file_exists(request.chords_path):
            raise HTTPException(status_code=404, detail=f"Chords not found: {request.chords_path}")
        if not _storage.file_exists(request.audio_path):
            raise HTTPException(status_code=404, detail=f"Audio not found: {request.audio_path}")

        local_chords = _storage.resolve_input(request.chords_path)
        with open(local_chords) as f:
            raw = json.load(f)
        chord_results = [
            ChordResult(
                start_time=c["start_time"], end_time=c["end_time"],
                chord=c["chord"], bass=c.get("bass"),
            )
            for c in raw
        ]

        # Beat-align the existing chords.
        local_audio = _storage.resolve_input(request.audio_path)
        beats, downbeats = track_file_beats(local_audio)
        if beats:
            chord_results = snap_chords_to_beats(chord_results, beats)

        # Slash bass (optional — needs the separated bass stem).
        bass_count = 0
        if request.bass_path and _storage.file_exists(request.bass_path):
            local_bass = _storage.resolve_input(request.bass_path)
            chord_results = detect_bass_for_chords(local_bass, chord_results)
            bass_count = sum(1 for c in chord_results if c.bass)

        out_path = os.path.join(job_dir, "chords.json")
        with open(out_path, "w") as f:
            json.dump(
                [
                    {
                        "start_time": c.start_time, "end_time": c.end_time,
                        "chord": c.chord, "bass": c.bass,
                    }
                    for c in chord_results
                ],
                f, indent=2,
            )

        # Regenerate the simplified difficulty variants from the enhanced
        # chords, so beginner/capo sheets carry the same beat-aligned timing.
        options = generate_simplified_options(chord_results)
        write_simplified_outputs(options, job_dir)

        # Persist the beat grid, keeping the song's other chord_meta.json fields.
        meta_path = os.path.join(job_dir, "chord_meta.json")
        with open(meta_path, "w") as f:
            json.dump(beat_meta(beats, downbeats), f, indent=2)
        _merge_existing_meta(meta_path, request.chords_path)

        _storage.store_outputs(job_dir, request.chords_path)

        chords = [
            ChordInfo(start_time=c.start_time, end_time=c.end_time, chord=c.chord, bass=c.bass)
            for c in chord_results
        ]
        logger.info(
            "Enhance done: %d chords, %d beats, %d slash-bass, %d variants",
            len(chords), len(beats), bass_count, len(options["options"]),
            extra={"event_type": "enhance_done", "chords_path": request.chords_path},
        )
        return EnhanceResponse(
            chords=chords, chords_path=request.chords_path,
            beats_detected=len(beats), bass_count=bass_count,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Enhance failed", extra={"event_type": "enhance_failed"})
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        _storage.release_inputs()
        if settings.processing.cleanup_temp and os.path.exists(job_dir):
            shutil.rmtree(job_dir, ignore_errors=True)


handler = Mangum(app)
