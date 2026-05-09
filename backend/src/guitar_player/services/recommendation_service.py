"""Song recommendation engine using weighted multi-factor scoring."""

import asyncio
import logging
import uuid
from dataclasses import dataclass, field

from guitar_player.dao.song_dao import SongDAO
from guitar_player.schemas.records import SongRecord
from guitar_player.schemas.song import RecommendationsResponse, SongResponse
from guitar_player.storage import StorageBackend

logger = logging.getLogger(__name__)

# Scoring weights
_W_GENRE = 0.30
_W_CHORDS = 0.25
_W_ARTIST = 0.15
_W_BPM = 0.10
_W_KEY = 0.10
_W_CAPO = 0.05
_W_POPULARITY = 0.05

# Phase 1 uses only DB fields; phase 2 enriches top candidates with storage data.
_PHASE1_CANDIDATE_LIMIT = 200
_PHASE2_ENRICHMENT_LIMIT = 30

# Circle of fifths for key distance calculation
_CIRCLE_MAJOR = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"]
_RELATIVE_MINOR: dict[str, str] = {
    "C": "Am", "G": "Em", "D": "Bm", "A": "F#m", "E": "C#m", "B": "G#m",
    "F#": "D#m", "Db": "Bbm", "Ab": "Fm", "Eb": "Cm", "Bb": "Gm", "F": "Dm",
}
# Build reverse lookup: minor -> major
_MINOR_TO_MAJOR: dict[str, str] = {v: k for k, v in _RELATIVE_MINOR.items()}

# Enharmonic equivalents for normalization
_ENHARMONIC: dict[str, str] = {
    "Gb": "F#", "C#": "Db", "G#": "Ab", "D#": "Eb", "A#": "Bb",
    "Gbm": "F#m", "C#m": "Dbm", "G#m": "Abm", "D#m": "Ebm", "A#m": "Bbm",
}


def _is_ascii(text: str) -> bool:
    """Return True if the string contains only ASCII characters (English)."""
    return all(ord(c) < 128 for c in text)


@dataclass
class _SongMetadata:
    """Enriched metadata for scoring (loaded from storage)."""

    song_key: str | None = None
    bpm: float | None = None
    capo: int | None = None
    chord_names: set[str] = field(default_factory=set)


def _normalize_key(key: str | None) -> str | None:
    """Normalize a musical key to its canonical form."""
    if not key:
        return None
    key = key.strip()
    return _ENHARMONIC.get(key, key)


def _key_to_major(key: str | None) -> str | None:
    """Convert any key (major or minor) to its major equivalent."""
    if not key:
        return None
    key = _normalize_key(key)
    if key in _MINOR_TO_MAJOR:
        return _MINOR_TO_MAJOR[key]
    if key in _CIRCLE_MAJOR:
        return key
    return None


def circle_of_fifths_distance(key_a: str | None, key_b: str | None) -> int | None:
    """Return the shortest distance (0-6) between two keys on the circle of fifths.

    Returns None if either key is unrecognized.
    """
    major_a = _key_to_major(key_a)
    major_b = _key_to_major(key_b)
    if major_a is None or major_b is None:
        return None
    if major_a == major_b:
        return 0
    try:
        idx_a = _CIRCLE_MAJOR.index(major_a)
        idx_b = _CIRCLE_MAJOR.index(major_b)
    except ValueError:
        return None
    raw = abs(idx_a - idx_b)
    return min(raw, 12 - raw)


def chord_jaccard_similarity(set_a: set[str], set_b: set[str]) -> float:
    """Jaccard similarity between two sets of chord names (0.0 to 1.0)."""
    if not set_a or not set_b:
        return 0.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union > 0 else 0.0


def _extract_chord_names(chord_data: list) -> set[str]:
    """Extract unique chord names from a chord JSON list."""
    names: set[str] = set()
    for entry in chord_data:
        if isinstance(entry, dict):
            chord = entry.get("chord", "")
            if chord and chord != "N":
                names.add(chord)
    return names


class RecommendationService:
    """Recommends songs similar to a given seed song."""

    def __init__(self, song_dao: SongDAO, storage: StorageBackend) -> None:
        self._song_dao = song_dao
        self._storage = storage

    async def get_recommendations(
        self, song_id: uuid.UUID, limit: int = 10,
    ) -> RecommendationsResponse:
        """Return up to *limit* recommended songs for the given seed."""
        seed = await self._song_dao.get_by_id(song_id)
        if not seed:
            return RecommendationsResponse(items=[], seed_song_id=song_id)

        # Phase 1: fetch candidates from DB (match language of seed)
        seed_is_english = _is_ascii(seed.title)
        candidates = await self._song_dao.list_recommendation_candidates(
            exclude_id=song_id,
            genre=seed.genre,
            artist=seed.artist,
            limit=_PHASE1_CANDIDATE_LIMIT,
            english_only=seed_is_english,
        )
        if not candidates:
            return RecommendationsResponse(items=[], seed_song_id=song_id)

        # Phase 1 scoring (DB fields only) to narrow candidates
        max_likes = max((c.like_count for c in candidates), default=1) or 1
        phase1_scores = []
        for c in candidates:
            score = _score_db_fields(seed, c, max_likes)
            phase1_scores.append((c, score))
        phase1_scores.sort(key=lambda x: x[1], reverse=True)
        top_candidates = [c for c, _ in phase1_scores[:_PHASE2_ENRICHMENT_LIMIT]]

        # Phase 2: enrich top candidates with storage metadata and re-score.
        # _load_metadata makes synchronous S3 calls, so run all concurrently in
        # a thread pool to avoid blocking the event loop.
        loop = asyncio.get_running_loop()
        all_metas = await asyncio.gather(
            *[loop.run_in_executor(None, self._load_metadata, s) for s in [seed, *top_candidates]]
        )
        seed_meta = all_metas[0]
        scored: list[tuple[SongRecord, float]] = []
        for c, c_meta in zip(top_candidates, all_metas[1:]):
            score = self._compute_similarity(seed, seed_meta, c, c_meta, max_likes)
            scored.append((c, score))
        scored.sort(key=lambda x: x[1], reverse=True)

        items = [
            self._enrich_response(SongResponse.model_validate(rec))
            for rec, _ in scored[:limit]
        ]
        return RecommendationsResponse(items=items, seed_song_id=song_id)

    def _enrich_response(self, resp: SongResponse) -> SongResponse:
        """Resolve thumbnail_key into a presigned thumbnail_url."""
        if resp.thumbnail_key:
            resp.thumbnail_url = self._storage.get_url(resp.thumbnail_key)
        return resp

    def _load_metadata(self, song: SongRecord) -> _SongMetadata:
        """Load chord_meta.json and chord file from storage for a song."""
        meta = _SongMetadata()
        if not song.song_name:
            return meta

        # Read chord_meta.json
        meta_key = f"{song.song_name}/chord_meta.json"
        try:
            if self._storage.file_exists(meta_key):
                raw = self._storage.read_json(meta_key)
                if isinstance(raw, dict):
                    meta.song_key = raw.get("key") or None
                    meta.bpm = raw.get("bpm") or None
                    meta.capo = raw.get("capo") or None
        except Exception:
            logger.debug("Failed to read chord_meta for %s", song.song_name)

        # Read chord file for chord names
        chord_key = song.web_chords_key
        if not chord_key:
            chord_key = f"{song.song_name}/chords_web.json"
        try:
            if self._storage.file_exists(chord_key):
                raw = self._storage.read_json(chord_key)
                if isinstance(raw, list):
                    meta.chord_names = _extract_chord_names(raw)
        except Exception:
            logger.debug("Failed to read chords for %s", song.song_name)

        # Fall back to autochord chords if no web chords
        if not meta.chord_names and song.chords_key:
            try:
                if self._storage.file_exists(song.chords_key):
                    raw = self._storage.read_json(song.chords_key)
                    if isinstance(raw, list):
                        meta.chord_names = _extract_chord_names(raw)
            except Exception:
                logger.debug("Failed to read autochord for %s", song.song_name)

        return meta

    def _compute_similarity(
        self,
        seed: SongRecord,
        seed_meta: _SongMetadata,
        candidate: SongRecord,
        candidate_meta: _SongMetadata,
        max_likes: int,
    ) -> float:
        """Compute weighted similarity score between seed and candidate."""
        score = 0.0

        # Genre match
        if seed.genre and candidate.genre and seed.genre == candidate.genre:
            score += _W_GENRE

        # Artist match
        if seed.artist and candidate.artist and seed.artist == candidate.artist:
            score += _W_ARTIST

        # Chord overlap
        chord_sim = chord_jaccard_similarity(
            seed_meta.chord_names, candidate_meta.chord_names,
        )
        score += _W_CHORDS * chord_sim

        # BPM proximity
        if seed_meta.bpm and candidate_meta.bpm:
            bpm_diff = abs(seed_meta.bpm - candidate_meta.bpm)
            bpm_score = 1.0 - min(bpm_diff / 60.0, 1.0)
            score += _W_BPM * bpm_score

        # Key compatibility
        key_dist = circle_of_fifths_distance(
            seed_meta.song_key, candidate_meta.song_key,
        )
        if key_dist is not None:
            key_score = 1.0 - (key_dist / 6.0)
            score += _W_KEY * key_score

        # Capo match
        if seed_meta.capo is not None and candidate_meta.capo is not None:
            capo_diff = abs(seed_meta.capo - candidate_meta.capo)
            if capo_diff == 0:
                score += _W_CAPO
            elif capo_diff == 1:
                score += _W_CAPO * 0.5

        # Popularity boost
        pop_score = candidate.like_count / max_likes if max_likes > 0 else 0.0
        score += _W_POPULARITY * pop_score

        return score


def _score_db_fields(
    seed: SongRecord, candidate: SongRecord, max_likes: int,
) -> float:
    """Quick phase-1 scoring using only DB-available fields."""
    score = 0.0
    if seed.genre and candidate.genre and seed.genre == candidate.genre:
        score += _W_GENRE
    if seed.artist and candidate.artist and seed.artist == candidate.artist:
        score += _W_ARTIST
    pop_score = candidate.like_count / max_likes if max_likes > 0 else 0.0
    score += _W_POPULARITY * pop_score
    return score
