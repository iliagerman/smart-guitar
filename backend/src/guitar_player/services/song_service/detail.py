"""Song detail assembly -- builds the full SongDetailResponse."""

import logging
import re
import time
import uuid
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from guitar_player.dao.chord_vote_dao import ChordVoteDAO
from guitar_player.dao.song_dao import SongDAO
from guitar_player.exceptions import NotFoundError
from guitar_player.schemas.records import SongRecord
from guitar_player.schemas.song import (
    ChordEntry,
    ChordOption,
    LyricsSegment,
    LyricsWord,
    RhythmInfo,
    SongDetailResponse,
    SongResponse,
    SongSection,
    StemType,
    StemUrls,
    StrumEvent,
    TabNote,
)
from guitar_player.storage import StorageBackend

from .chord_time_snap import build_anchor_times, snap_chord_times
from .helpers import (
    CHORD_VARIANT_PREFIX,
    CHORD_VARIANT_SUFFIX,
    STEM_DEFINITIONS,
    STEM_NAMES,
    parse_lyrics_payload,
)
from .sheet_alignment import (
    TimedWord,
    align_sheet_lines_with_words,
    tokenize,
    trim_sheet_preamble,
)

logger = logging.getLogger(__name__)


async def build_song_detail(
    song_id: uuid.UUID,
    song_dao: SongDAO,
    chord_vote_dao: ChordVoteDAO,
    storage: StorageBackend,
) -> SongDetailResponse:
    """Build the full song detail response."""
    t0 = time.perf_counter()

    song = await song_dao.get_by_id(song_id)
    if not song:
        raise NotFoundError("Song", str(song_id))

    t1 = time.perf_counter()
    song_resp = SongResponse.model_validate(song)
    audio_url = _resolve_url(storage, song.audio_key)
    thumbnail_url = _resolve_url(storage, song.thumbnail_key)
    stems = _build_stems(storage, song)
    stem_types = _build_stem_types(stems)
    t2 = time.perf_counter()

    chord_data = _load_chords(storage, song)
    autochord_chords = chord_data.get("autochord", [])
    recommended_capo = chord_data.get("recommended_capo")
    song_key = chord_data.get("song_key")
    t3 = time.perf_counter()

    lyrics_data = await _load_all_lyrics(storage, song, song_dao)
    t4 = time.perf_counter()

    tabs, tabs_source, tab_strums, rhythm = await _load_tabs_and_strums(storage, song, song_dao)
    t5 = time.perf_counter()
    songsterr_data = _load_songsterr_data(storage, song)
    t6 = time.perf_counter()

    # Load community chord versions (converts to ChordOption objects)
    duration = float(song.duration_seconds or 240)
    community_options, community_tabs = _load_community_chord_options(
        storage, song, duration, lyrics_data,
        autochord_chords, chord_data.get("bar_starts", []),
    )
    t7 = time.perf_counter()

    chord_options = await _assemble_chord_options(
        storage, song, song_id, chord_vote_dao,
        autochord_chords, recommended_capo, lyrics_data,
        community_options,
    )
    t8 = time.perf_counter()

    total = t8 - t0
    if total >= 1.0:
        logger.warning(
            "build_song_detail slow %.2fs song=%s: db=%.2f s3_stems=%.2f chords=%.2f"
            " lyrics=%.2f tabs=%.2f songsterr=%.2f community=%.2f assemble=%.2f",
            total, song_id,
            t1 - t0, t2 - t1, t3 - t2, t4 - t3,
            t5 - t4, t6 - t5, t7 - t6, t8 - t7,
        )

    # Primary chords: detected audio timing is the default. Community sheets are
    # available as alternate sheet sources when the user explicitly chooses them.
    if autochord_chords:
        primary_chords = autochord_chords
        primary_source = "autochord"
    elif community_options and community_options[0].chords:
        primary_chords = community_options[0].chords
        primary_source = "community"
    else:
        primary_chords = []
        primary_source = None

    # Community tabs replace Songsterr tabs when available
    final_tabs = community_tabs or songsterr_data.get("tabs") or tabs
    final_tabs_source = ("community" if community_tabs else None) or songsterr_data.get("tabs_source") or tabs_source
    final_strums = songsterr_data.get("strums") or tab_strums

    return SongDetailResponse(
        song=song_resp,
        thumbnail_url=thumbnail_url,
        audio_url=audio_url,
        stems=stems,
        stem_types=stem_types,
        chords=primary_chords,
        chord_options=chord_options,
        lyrics=lyrics_data["lyrics"],
        lyrics_source=lyrics_data["lyrics_source"],
        quick_lyrics=lyrics_data["quick_lyrics"],
        quick_lyrics_source=lyrics_data["quick_lyrics_source"],
        ver1_lyrics=lyrics_data["quick_lyrics"],
        ver1_lyrics_source=lyrics_data["quick_lyrics_source"],
        ver2_lyrics=lyrics_data["lyrics"],
        ver2_lyrics_source=lyrics_data["lyrics_source"],
        ver4_lyrics=songsterr_data["ver4_lyrics"],
        ver4_lyrics_source=songsterr_data["ver4_lyrics_source"],
        tabs=final_tabs,
        tabs_source=final_tabs_source,
        strums=final_strums,
        rhythm=rhythm,
        sections=songsterr_data.get("sections", []),
        source_bpm=songsterr_data.get("source_bpm"),
        time_signature=songsterr_data.get("time_signature"),
        strum_notes=songsterr_data.get("strum_notes"),
        tutorial_url=songsterr_data.get("tutorial_url"),
        tutorial_links=songsterr_data.get("tutorial_links", []),
        songsterr_status=songsterr_data.get("songsterr_status"),
        chord_source=primary_source,
        recommended_capo=recommended_capo,
        song_key=song_key,
        detected_bpm=chord_data.get("detected_bpm"),
        bar_starts=chord_data.get("bar_starts", []),
        web_chords_failed=False,
        web_chords_pending=False,
        download_pending=song.download_requested_at is not None,
    )


def _resolve_url(storage: StorageBackend, key: str | None) -> str | None:
    if key and storage.file_exists(key):
        return storage.get_url(key)
    return None


def _build_stems(storage: StorageBackend, song: SongRecord) -> StemUrls:
    stems = StemUrls()
    for stem_name in STEM_NAMES:
        key = getattr(song, f"{stem_name}_key", None)
        if key and storage.file_exists(key):
            setattr(stems, stem_name, storage.get_url(key))
    return stems


def _build_stem_types(stems: StemUrls) -> list[StemType]:
    """Return only stem types that are currently available for playback.

    The API contract says ``stem_types`` should list stems actually produced for a
    song. Returning the full catalog keeps missing optional stems looking
    perpetually "pending" on the frontend and can trigger needless polling.
    """
    available = {stem_name for stem_name in STEM_NAMES if getattr(stems, stem_name, None)}
    return [stem for stem in STEM_DEFINITIONS if stem.name in available]


def _load_chords(
    storage: StorageBackend, song: SongRecord,
) -> dict[str, Any]:
    """Load autochord chords and chord metadata."""
    autochord = _read_chord_file(storage, song.chords_key)

    # Gemini chord detection disabled — community chords from UG used instead.

    recommended_capo: int | None = None
    song_key: str | None = None
    detected_bpm: float | None = None
    bar_starts: list[float] = []
    if song.song_name:
        meta_key = f"{song.song_name}/chord_meta.json"
        if storage.file_exists(meta_key):
            try:
                meta = storage.read_json(meta_key)
                if isinstance(meta, dict):
                    recommended_capo = meta.get("capo") or None
                    song_key = meta.get("key") or None
                    detected_bpm = meta.get("bpm") or None
                    raw_bars = meta.get("bar_starts")
                    if isinstance(raw_bars, list):
                        bar_starts = [float(b) for b in raw_bars]
            except Exception as e:
                logger.warning("Failed to read chord_meta for %s: %s", song.song_name, e)

    return {
        "autochord": autochord,
        "recommended_capo": recommended_capo,
        "song_key": song_key,
        "detected_bpm": detected_bpm,
        "bar_starts": bar_starts,
    }


def _read_chord_file(storage: StorageBackend, key: str | None) -> list[ChordEntry]:
    if not key or not storage.file_exists(key):
        return []
    try:
        raw = storage.read_json(key)
        if isinstance(raw, list):
            return [ChordEntry(**c) for c in raw]
    except Exception as e:
        logger.warning("Failed to read chords from %s: %s", key, e)
    return []


def _parse_time_signature(value: str | None) -> tuple[int, int] | None:
    if not value or "/" not in value:
        return None
    left, right = value.split("/", 1)
    try:
        return int(left), int(right)
    except ValueError:
        return None




async def _load_all_lyrics(
    storage: StorageBackend, song: SongRecord, song_dao: SongDAO,
) -> dict[str, Any]:
    """Load all lyrics versions into a dict."""
    result: dict[str, Any] = {
        "lyrics": [], "lyrics_source": None, "lyrics_payload": None,
        "quick_lyrics": [], "quick_lyrics_source": None, "quick_lyrics_payload": None,
    }

    if song.lyrics_key and storage.file_exists(song.lyrics_key):
        try:
            raw = storage.read_json(song.lyrics_key)
            result["lyrics"], result["lyrics_source"], result["lyrics_payload"] = (
                parse_lyrics_payload(raw)
            )
        except Exception as e:
            logger.warning("Failed to read lyrics for %s: %s", song.song_name, e)

    await _load_quick_lyrics(storage, song, song_dao, result)

    return result


async def _load_quick_lyrics(
    storage: StorageBackend, song: SongRecord, song_dao: SongDAO,
    result: dict[str, Any],
) -> None:
    quick_key = song.lyrics_quick_key
    if not quick_key and song.song_name:
        candidate = f"{song.song_name}/lyrics_quick.json"
        if storage.file_exists(candidate):
            quick_key = candidate
            # Persist to DB so future requests don't need the probe
            await song_dao.update_by_id(song.id, lyrics_quick_key=candidate)

    if not quick_key or not storage.file_exists(quick_key):
        return

    try:
        raw = storage.read_json(quick_key)
        result["quick_lyrics"], result["quick_lyrics_source"], result["quick_lyrics_payload"] = (
            parse_lyrics_payload(raw)
        )
    except Exception as e:
        logger.warning("Failed to read quick lyrics for %s: %s", song.song_name, e)


async def _load_tabs_and_strums(
    storage: StorageBackend, song: SongRecord, song_dao: SongDAO,
) -> tuple[list[TabNote], str | None, list[StrumEvent], RhythmInfo | None]:
    """Load tabs, strums, and rhythm from tabs.json."""
    tabs: list[TabNote] = []
    strums: list[StrumEvent] = []
    tabs_source: str | None = None
    rhythm: RhythmInfo | None = None

    tabs_key = song.tabs_key
    if not tabs_key and song.song_name:
        candidate = f"{song.song_name}/tabs.json"
        if storage.file_exists(candidate):
            tabs_key = candidate
            # Persist to DB so future requests don't need the probe
            await song_dao.update_by_id(song.id, tabs_key=candidate)
            await song_dao.commit()

    if not tabs_key or not storage.file_exists(tabs_key):
        return tabs, tabs_source, strums, rhythm

    try:
        raw = storage.read_json(tabs_key)
        if isinstance(raw, dict):
            if isinstance(raw.get("notes"), list):
                tabs = [TabNote(**n) for n in raw["notes"]]
                tabs_source = "detected"
            if isinstance(raw.get("strums"), list):
                strums = [StrumEvent(**s) for s in raw["strums"]]
            if isinstance(raw.get("rhythm"), dict):
                rhythm = RhythmInfo(**raw["rhythm"])
    except Exception as e:
        logger.warning("Failed to read tabs for %s: %s", song.song_name, e)

    return tabs, tabs_source, strums, rhythm


def _load_songsterr_data(storage: StorageBackend, song: SongRecord) -> dict[str, Any]:
    """Load Songsterr enriched data (tabs, strums, sections, etc.)."""
    result: dict[str, Any] = {
        "strums": [], "tabs": None, "tabs_source": None,
        "sections": [], "source_bpm": None, "time_signature": None,
        "strum_notes": None, "tutorial_url": None, "tutorial_links": [],
        "songsterr_status": None, "ver4_lyrics": [], "ver4_lyrics_source": None,
    }

    if song.external_strums_failed:
        result["songsterr_status"] = "failed"
    elif not song.artist or not song.song_name:
        result["songsterr_status"] = "unavailable"

    external_strums_key = song.external_strums_key
    if external_strums_key and storage.file_exists(external_strums_key):
        result["songsterr_status"] = "ready"
        try:
            raw = storage.read_json(external_strums_key)
            if isinstance(raw, dict):
                _parse_enriched_songsterr(raw, result)
            elif isinstance(raw, list):
                result["strums"] = [StrumEvent(**s) for s in raw]
        except Exception as e:
            logger.warning("Failed to read Songsterr data for %s: %s", song.song_name, e)

    if song.song_name:
        _load_songsterr_lyrics(storage, song.song_name, result)

    # On-demand tutorial recovery writes {song_name}/tutorial.json directly to
    # storage (no DB pointer). Surface it when the Songsterr file had none.
    if not result["tutorial_url"] and song.song_name:
        _load_tutorial_fallback(storage, song.song_name, result)

    return result


def _load_tutorial_fallback(
    storage: StorageBackend, song_name: str, result: dict[str, Any],
) -> None:
    """Read tutorial fields from the on-demand {song_name}/tutorial.json file.

    Independent of external_strums_key (NULL for songs that never ran the
    Songsterr step), so backfilled tutorials surface for old songs too.
    """
    key = f"{song_name}/tutorial.json"
    if not storage.file_exists(key):
        return
    try:
        raw = storage.read_json(key)
    except Exception as e:
        logger.warning("Failed to read tutorial.json for %s: %s", song_name, e)
        return
    if not isinstance(raw, dict):
        return
    if raw.get("tutorial_url"):
        result["tutorial_url"] = raw["tutorial_url"]
    if isinstance(raw.get("tutorial_links"), list):
        result["tutorial_links"] = raw["tutorial_links"]


def _load_songsterr_lyrics(
    storage: StorageBackend, song_name: str, result: dict[str, Any],
) -> None:
    songsterr_lyrics_key = f"{song_name}/lyrics_songsterr.json"
    if not storage.file_exists(songsterr_lyrics_key):
        return
    try:
        raw_sl = storage.read_json(songsterr_lyrics_key)
        result["ver4_lyrics"], result["ver4_lyrics_source"], _ = (
            parse_lyrics_payload(raw_sl)
        )
    except Exception as e:
        logger.warning("Failed to read Songsterr lyrics for %s: %s", song_name, e)


def _parse_enriched_songsterr(raw: dict[str, Any], result: dict[str, Any]) -> None:
    """Parse enriched Songsterr format into the result dict."""
    if isinstance(raw.get("strums"), list):
        result["strums"] = [StrumEvent(**s) for s in raw["strums"]]
    if isinstance(raw.get("tabs"), list) and raw["tabs"]:
        result["tabs"] = [TabNote(**n) for n in raw["tabs"]]
        result["tabs_source"] = "songsterr"
    if isinstance(raw.get("sections"), list):
        result["sections"] = [SongSection(**s) for s in raw["sections"]]
    if raw.get("source_bpm"):
        result["source_bpm"] = float(raw["source_bpm"])
    if isinstance(raw.get("time_signature"), list):
        result["time_signature"] = raw["time_signature"]
    if raw.get("strum_notes"):
        result["strum_notes"] = raw["strum_notes"]
    if raw.get("tutorial_url"):
        result["tutorial_url"] = raw["tutorial_url"]
    if isinstance(raw.get("tutorial_links"), list):
        result["tutorial_links"] = raw["tutorial_links"]


# A matched whisper word is untrusted input (mishearings, dropped/extra
# words, wrong occurrence of a repeated line): only accept it as a real
# anchor when it lands within this margin of its line's window.
_WORD_ANCHOR_MARGIN = 0.5
# A line whose accepted-anchor fraction falls below this is too unreliable
# to trust at all — its words/chords fall back to plain interpolation,
# exactly as if no whisper words had been supplied for it.
_LINE_WORD_QUALITY_THRESHOLD = 0.4

_WORD_SPAN_RE = re.compile(r"\S+")


@dataclass
class _WordMapping:
    """Per-display-word whisper times, plus the accepted anchors behind them."""

    times: list[tuple[float, float] | None]
    accepted_starts: list[float]
    accepted_end_max: float | None
    accepted_count: int


@dataclass
class _LineDraft:
    """One timed sheet line's chord/lyric timing, before final assembly.

    ``anchor_span`` is the (first, last) accepted whisper anchor time behind
    this line's word mapping, or None when the line used plain
    interpolation. It's consumed (and can zero out a line) by the
    cross-line monotonicity sweep.
    """

    text: str
    raw_chords: list[dict]
    seg_start: float
    seg_end: float
    chord_starts: list[float]
    lyric_words: list[LyricsWord]
    anchor_span: tuple[float, float] | None


def _word_spans(text: str) -> list[tuple[int, int]]:
    """Character (start, end) span of each whitespace-delimited display word."""
    return [(m.start(), m.end()) for m in _WORD_SPAN_RE.finditer(text)]


def _match_words_to_whisper(
    display_words: list[str],
    whisper_words: list[TimedWord],
    line_start: float,
    line_end: float,
) -> _WordMapping:
    """Align display words to whisper words, rejecting untrustworthy pairings.

    A candidate pairing (from a `SequenceMatcher` "equal" opcode — identical
    normalized tokens) is only accepted if its time falls near the line's
    window and doesn't move backwards relative to the last accepted anchor
    in this line. A bad transcript pairing is thus quarantined to a single
    rejected word rather than corrupting the whole line.
    """
    display_tokens: list[str] = []
    owner: list[int] = []
    for idx, w in enumerate(display_words):
        for t in tokenize(w):
            display_tokens.append(t)
            owner.append(idx)
    whisper_tokens = [w.token for w in whisper_words]

    lo, hi = line_start - _WORD_ANCHOR_MARGIN, line_end + _WORD_ANCHOR_MARGIN
    matched: dict[int, tuple[float, float]] = {}
    last_accepted = float("-inf")
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, display_tokens, whisper_tokens).get_opcodes():
        if tag != "equal":
            continue
        for offset in range(i2 - i1):
            w = whisper_words[j1 + offset]
            if not (lo <= w.start <= hi) or w.start < last_accepted:
                continue
            widx = owner[i1 + offset]
            prev = matched.get(widx)
            matched[widx] = (w.start, w.end) if prev is None else (min(prev[0], w.start), max(prev[1], w.end))
            last_accepted = max(last_accepted, w.end)

    times: list[tuple[float, float] | None] = [matched.get(i) for i in range(len(display_words))]
    accepted_starts = [matched[i][0] for i in sorted(matched)]
    accepted_end_max = max((e for _, e in matched.values()), default=None)
    return _WordMapping(times, accepted_starts, accepted_end_max, len(matched))


def _fallback_lyric_word_times(n: int, start: float, end: float) -> list[tuple[float, float]]:
    if n == 0:
        return []
    dur = (end - start) / n
    return [(round(start + i * dur, 3), round(start + (i + 1) * dur, 3)) for i in range(n)]


def _interpolate_word_times(
    times: list[tuple[float, float] | None], line_start: float, line_end: float,
) -> list[tuple[float, float]]:
    """Fill unmatched slots by even distribution between accepted neighbors."""
    n = len(times)
    matched_idx = [i for i, t in enumerate(times) if t is not None]
    if not matched_idx:
        return _fallback_lyric_word_times(n, line_start, line_end)

    result: list[tuple[float, float] | None] = list(times)

    def _fill(lo: int, hi: int, t0: float, t1: float) -> None:
        count = hi - lo - 1
        if count <= 0:
            return
        span = max(t1 - t0, 0.0)
        step = span / count
        for k in range(1, count + 1):
            result[lo + k] = (t0 + (k - 1) * step, t0 + k * step)

    first, last = matched_idx[0], matched_idx[-1]
    _fill(-1, first, line_start, result[first][0])
    for a, b in zip(matched_idx, matched_idx[1:]):
        _fill(a, b, result[a][1], result[b][0])
    _fill(last, n, result[last][1], max(line_end, result[last][1]))
    return [(round(s, 3), round(e, 3)) for s, e in result]


def _map_words_to_whisper_times(
    display_words: list[str],
    whisper_words: list[TimedWord],
    line_start: float,
    line_end: float,
) -> list[tuple[float, float]]:
    """Map each display word to a (start, end) time using validated whisper anchors.

    Words with no accepted anchor (rejected as untrustworthy, or simply
    absent from the transcript) interpolate between their nearest accepted
    neighbors, or the line window edges.
    """
    mapping = _match_words_to_whisper(display_words, whisper_words, line_start, line_end)
    return _interpolate_word_times(mapping.times, line_start, line_end)


def _word_index_for_position(spans: list[tuple[int, int]], position: int) -> int:
    """Index of the display word a character position falls on (or the next
    word starting at/after it; clamped to the last word past the line end)."""
    for idx, (start, end) in enumerate(spans):
        if (start <= position < end) or position < start:
            return idx
    return len(spans) - 1


def _chord_starts_from_words(
    raw_chords: list[dict],
    spans: list[tuple[int, int]],
    word_times: list[tuple[float, float]],
) -> list[float]:
    """Chord start times from the real word time each chord's position lands on.

    Multiple chords landing on the same word are distributed evenly across
    that word's span so their starts stay strictly increasing.
    """
    if not spans:
        return []
    indices = [_word_index_for_position(spans, c.get("position", 0)) for c in raw_chords]
    starts: list[float] = []
    i, n = 0, len(indices)
    while i < n:
        j = i
        while j < n and indices[j] == indices[i]:
            j += 1
        word_start, word_end = word_times[indices[i]]
        span = word_end - word_start
        # A zero-span word (whisper start == end) would collapse all its
        # chords onto one start; keep them strictly increasing instead.
        step = span / (j - i) if span > 0 else 0.01
        starts.extend(word_start + k * step for k in range(j - i))
        i = j
    return starts


def _fallback_chord_starts(
    raw_chords: list[dict], text: str, seg_start: float, seg_span: float,
) -> list[float]:
    chord_count = len(raw_chords)
    text_len = len(text)
    starts: list[float] = []
    for ci, c in enumerate(raw_chords):
        if text_len > 0:
            fraction = min(max(c.get("position", 0), 0), text_len) / text_len
        else:
            fraction = ci / max(chord_count, 1)
        starts.append(seg_start + fraction * seg_span)
    return starts


def _fallback_lyric_words(text: str, seg_start: float, seg_span: float) -> list[LyricsWord]:
    words_raw = text.split()
    word_dur = seg_span / max(len(words_raw), 1)
    return [
        LyricsWord(
            word=w,
            start=round(seg_start + j * word_dur, 3),
            end=round(seg_start + (j + 1) * word_dur, 3),
        )
        for j, w in enumerate(words_raw)
    ]


def _build_fallback_draft(
    raw_chords: list[dict], text: str, seg_start: float, seg_end: float,
) -> _LineDraft:
    seg_span = max(seg_end - seg_start, 0.0)
    return _LineDraft(
        text, raw_chords, seg_start, seg_end,
        chord_starts=_fallback_chord_starts(raw_chords, text, seg_start, seg_span),
        lyric_words=_fallback_lyric_words(text, seg_start, seg_span),
        anchor_span=None,
    )


def _build_word_mapped_draft(
    raw_chords: list[dict],
    text: str,
    seg_start: float,
    seg_end: float,
    words_for_line: list[TimedWord],
) -> _LineDraft | None:
    """Word-anchored draft for a line, or None if too few anchors survived
    validation to trust this line's word mapping at all."""
    spans = _word_spans(text)
    display_words = [text[s:e] for s, e in spans]
    mapping = _match_words_to_whisper(display_words, words_for_line, seg_start, seg_end)
    if mapping.accepted_count / max(len(display_words), 1) < _LINE_WORD_QUALITY_THRESHOLD:
        return None

    word_times = _interpolate_word_times(mapping.times, seg_start, seg_end)
    lyric_words = [LyricsWord(word=dw, start=s, end=e) for dw, (s, e) in zip(display_words, word_times)]
    anchor_span = (
        (mapping.accepted_starts[0], mapping.accepted_end_max) if mapping.accepted_starts else None
    )
    return _LineDraft(
        text, raw_chords, seg_start, seg_end,
        chord_starts=_chord_starts_from_words(raw_chords, spans, word_times),
        lyric_words=lyric_words,
        anchor_span=anchor_span,
    )


def _enforce_global_monotonicity(drafts: list[_LineDraft]) -> None:
    """Demote any line whose accepted anchors run backwards relative to an
    earlier line (e.g. a repeated chorus matched to the wrong occurrence),
    so real time never regresses across a line boundary."""
    running_max = float("-inf")
    for draft in drafts:
        if draft.anchor_span is None:
            continue
        first, last = draft.anchor_span
        if first < running_max:
            fallback = _build_fallback_draft(draft.raw_chords, draft.text, draft.seg_start, draft.seg_end)
            draft.chord_starts = fallback.chord_starts
            draft.lyric_words = fallback.lyric_words
            draft.anchor_span = None
        else:
            running_max = max(running_max, last)


def _line_drafts(
    raw_lines: list[dict],
    duration: float,
    line_windows: list[tuple[float, float] | None] | None,
    line_words: list[list[TimedWord] | None] | None,
) -> list[_LineDraft]:
    lyric_lines = [
        line for line in raw_lines
        if isinstance(line, dict) and line.get("type") in ("lyric", "instrumental")
    ]
    line_duration = duration / max(len(lyric_lines), 1)

    drafts: list[_LineDraft] = []
    line_idx = 0
    for raw_idx, line in enumerate(raw_lines):
        if not isinstance(line, dict):
            continue
        line_type = line.get("type", "")
        if line_type not in ("lyric", "instrumental"):
            continue

        window = line_windows[raw_idx] if line_windows else None
        seg_start, seg_end = window or (line_idx * line_duration, (line_idx + 1) * line_duration)
        text = line.get("text", "")
        raw_chords = line.get("chords", [])

        words_for_line = line_words[raw_idx] if line_words else None
        draft = None
        if words_for_line and line_type == "lyric" and text:
            draft = _build_word_mapped_draft(raw_chords, text, seg_start, seg_end, words_for_line)
        drafts.append(draft or _build_fallback_draft(raw_chords, text, seg_start, seg_end))
        line_idx += 1

    _enforce_global_monotonicity(drafts)
    return drafts


def _static_lines_to_chord_option(
    raw_lines: list[dict],
    duration: float,
    name: str,
    capo: int = 0,
    key: str = "",
    line_windows: list[tuple[float, float] | None] | None = None,
    line_words: list[list[TimedWord] | None] | None = None,
) -> ChordOption:
    """Convert static chord lines (position-based) to a ChordOption (time-based).

    When *line_windows* (from whisper alignment) is provided, each line gets
    its real audio time window so the sheet auto-scrolls in sync. When
    *line_words* is also given for a line, its words/chords are placed on
    the real matched whisper timestamps rather than an even split — but only
    using anchors that survive validation (see `_match_words_to_whisper` and
    `_enforce_global_monotonicity`); everything else falls back to the
    original char-position/even-split interpolation, never worse than it.
    """
    drafts = _line_drafts(raw_lines, duration, line_windows, line_words)

    chords: list[ChordEntry] = []
    lyrics: list[LyricsSegment] = []
    for draft in drafts:
        chord_count = len(draft.raw_chords)
        for ci, c in enumerate(draft.raw_chords):
            chord_start = draft.chord_starts[ci]
            chord_end = draft.chord_starts[ci + 1] if ci + 1 < chord_count else draft.seg_end
            chords.append(ChordEntry(
                start_time=round(chord_start, 3),
                end_time=round(max(chord_end, chord_start), 3),
                chord=c.get("chord", ""),
            ))
        if draft.text:
            lyrics.append(LyricsSegment(
                start=round(draft.seg_start, 3),
                end=round(draft.seg_end, 3),
                text=draft.text,
                words=draft.lyric_words,
            ))

    description = "Community chord sheet"
    if key:
        description += f" (Key: {key})"
    if line_windows:
        description += " · synced to audio"

    return ChordOption(
        name=name,
        description=description,
        capo=capo,
        chords=chords,
        lyrics=lyrics,
        lyrics_source="community",
        lyrics_synced=line_windows is not None,
    )


def _load_community_chord_options(
    storage: StorageBackend,
    song: SongRecord,
    duration: float,
    lyrics_data: dict[str, Any],
    autochord_chords: list[ChordEntry],
    bar_starts: list[float],
) -> tuple[list[ChordOption], list[TabNote] | None]:
    """Load community chord versions and tab from static_chords.json.

    Returns (chord_options, tab_notes). Each chord version becomes a
    ChordOption with estimated timing so it works with capo/easy/transpose.
    Synced sheets additionally get their chord starts snapped onto detected
    beat anchors (autochord chord changes and/or the bar grid) when one is
    close by, so strums land on the beat.
    """
    key = song.static_chords_key
    if not key and song.song_name:
        candidate = f"{song.song_name}/static_chords.json"
        if storage.file_exists(candidate):
            key = candidate

    if not key or not storage.file_exists(key):
        return [], None

    try:
        raw = storage.read_json(key)
        if not isinstance(raw, dict):
            return [], None

        # Whisper lyrics (ver2) give real line timing when the sheet matches.
        whisper_segments: list[LyricsSegment] = lyrics_data.get("lyrics") or []
        anchor_times = build_anchor_times(autochord_chords, bar_starts)

        def _build_option(raw_lines: list[dict], name: str, capo: int, song_key: str) -> ChordOption:
            raw_lines = trim_sheet_preamble(raw_lines)
            content_start = anchor_times[0] if anchor_times else None
            aligned = align_sheet_lines_with_words(
                raw_lines, whisper_segments, duration=duration, content_start=content_start,
            )
            line_windows = [None if a is None else (a.start, a.end) for a in aligned] if aligned else None
            line_words = [None if a is None else a.words for a in aligned] if aligned else None
            option = _static_lines_to_chord_option(
                raw_lines, duration, name=name, capo=capo, key=song_key,
                line_windows=line_windows, line_words=line_words,
            )
            if option.lyrics_synced and anchor_times:
                option.chords = snap_chord_times(option.chords, anchor_times)
            return option

        options: list[ChordOption] = []

        # New multi-version format: {"versions": [...]}
        versions = raw.get("versions", [])
        if versions:
            for i, version in enumerate(versions):
                if not isinstance(version, dict):
                    continue
                raw_lines = version.get("lines", [])
                if not raw_lines:
                    continue
                options.append(_build_option(
                    raw_lines, f"Sheet {i + 1}",
                    version.get("capo", 0), version.get("key", ""),
                ))
        else:
            # Legacy single-version format: {"lines": [...]}
            raw_lines = raw.get("lines", [])
            if raw_lines:
                options.append(_build_option(
                    raw_lines, "Sheet 1", raw.get("capo", 0), raw.get("key", ""),
                ))

        # Parse tab content (raw text tab from UG)
        tab_notes: list[TabNote] | None = None
        tab_content = raw.get("tab_content")
        if tab_content and isinstance(tab_content, str):
            # Store as a single TabNote-compatible entry for the frontend
            # The tab content is raw text, rendered by the frontend TabsSheet
            # For now, pass through as-is via a marker in tabs_source
            pass  # tabs are handled via raw tab_content field in the JSON

        return options, tab_notes

    except Exception as e:
        logger.warning("Failed to read community chords for %s: %s", song.song_name, e)
        return [], None


async def _assemble_chord_options(
    storage: StorageBackend,
    song: SongRecord,
    song_id: uuid.UUID,
    chord_vote_dao: ChordVoteDAO,
    autochord_chords: list[ChordEntry],
    recommended_capo: int | None,
    lyrics_data: dict[str, Any],
    community_options: list[ChordOption],
) -> list[ChordOption]:
    """Assemble chord options with detected chords as the default source."""
    chord_options: list[ChordOption] = []
    user_versions, variant_options = _load_chord_variants_from_disk(storage, song.song_name)

    # Enrich user versions with vote scores
    try:
        vote_counts = await chord_vote_dao.get_vote_counts(song_id)
        for option in user_versions:
            if option.version_key and option.version_key in vote_counts:
                option.vote_score = vote_counts[option.version_key]
                option.hidden = option.vote_score <= -10
    except Exception as e:
        logger.warning("Failed to load chord vote counts for %s: %s", song_id, e)
        await chord_vote_dao.rollback()

    # Best system lyrics: ver2 (whisper, verbatim) > ver1 (online quick)
    best_lyrics = (
        lyrics_data["lyrics"]
        or lyrics_data["quick_lyrics"]
        or None
    )
    best_lyrics_source = (
        lyrics_data["lyrics_source"]
        or lyrics_data["quick_lyrics_source"]
    )

    # Autochord detected chords first so every new song opens on the audio
    # timeline. Lyrics are optional; without them the frontend still renders an
    # instrumental chord timeline.
    if autochord_chords:
        chord_options.append(
            ChordOption(
                name="Detected",
                description="Auto-detected chords",
                capo=0,
                chords=autochord_chords,
                lyrics=best_lyrics,
                lyrics_source=best_lyrics_source,
            )
        )

    # Community chord sheets remain selectable alternatives.
    chord_options.extend(community_options)

    # User-created versions (auto-pair legacy saves that have no lyrics)
    for opt in user_versions:
        if opt.lyrics is None:
            opt.lyrics = best_lyrics
            opt.lyrics_source = best_lyrics_source
        chord_options.append(opt)

    # Beginner/capo variants at the end
    for opt in variant_options:
        opt.is_variant = True
    chord_options.extend(variant_options)

    return chord_options


def _load_chord_variants_from_disk(
    storage: StorageBackend, song_name: str,
) -> tuple[list[ChordOption], list[ChordOption]]:
    """Load user-created and system variant chord files from storage."""
    user_versions: list[ChordOption] = []
    variant_options: list[ChordOption] = []

    if not song_name:
        return user_versions, variant_options

    try:
        files = storage.list_files(song_name)
        has_web_variants = any("chords_web_" in f.rsplit("/", 1)[-1] for f in files)
        variant_keys = sorted(
            f
            for f in files
            if f.rsplit("/", 1)[-1].startswith(CHORD_VARIANT_PREFIX)
            and f.endswith(CHORD_VARIANT_SUFFIX)
            and "intermediate" not in f.rsplit("/", 1)[-1].lower()
            and (
                not has_web_variants
                or "chords_web_" in f.rsplit("/", 1)[-1]
                or "chords_user" in f.rsplit("/", 1)[-1]
            )
        )
        for key in variant_keys:
            option = _parse_variant_file(storage, key)
            if not option:
                continue
            filename = key.rsplit("/", 1)[-1]
            if "chords_user" in filename:
                user_versions.append(option)
            else:
                variant_options.append(option)
    except Exception as e:
        logger.warning("Failed to list chord variants for %s: %s", song_name, e)

    return user_versions, variant_options


def _parse_variant_file(storage: StorageBackend, key: str) -> ChordOption | None:
    """Parse a single chord variant JSON file into a ChordOption."""
    try:
        data = storage.read_json(key)
        if not isinstance(data, dict) or "chords" not in data:
            return None

        version_lyrics = None
        version_lyrics_source = None
        if isinstance(data.get("lyrics"), list):
            version_lyrics = [LyricsSegment(**seg) for seg in data["lyrics"]]
            version_lyrics_source = "user"

        return ChordOption(
            name=data.get("name", ""),
            description=data.get("description", ""),
            capo=data.get("capo", 0),
            chords=[ChordEntry(**c) for c in data["chords"]],
            lyrics=version_lyrics,
            lyrics_source=version_lyrics_source,
            version_key=key,
            created_by=data.get("created_by"),
        )
    except Exception as e:
        logger.warning("Failed to read chord variant %s: %s", key, e)
        return None
