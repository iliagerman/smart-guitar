"""Detect Whisper language code from Unicode script analysis of text.

Uses Python's built-in ``unicodedata`` module to identify the dominant writing
script in title/artist metadata.  This is more reliable than Whisper's
audio-based auto-detection for languages with distinct scripts (Hebrew,
Arabic, CJK, Cyrillic, etc.).

Returns ``None`` for Latin-script text, letting Whisper auto-detect normally.
"""

import logging
import unicodedata
from collections import Counter

logger = logging.getLogger(__name__)

# Map Unicode script names (first word of ``unicodedata.name()``) to Whisper
# language codes.  Only non-Latin scripts are listed — Latin text has too
# many possible languages to guess from script alone.
_SCRIPT_TO_WHISPER_LANG: dict[str, str] = {
    "HEBREW": "he",
    "ARABIC": "ar",
    "CYRILLIC": "ru",
    "HANGUL": "ko",
    "THAI": "th",
    "DEVANAGARI": "hi",
    "GEORGIAN": "ka",
    "ARMENIAN": "hy",
    "TAMIL": "ta",
    "BENGALI": "bn",
    "GREEK": "el",
    "TIBETAN": "bo",
    "MYANMAR": "my",
    "KHMER": "km",
    "LAO": "lo",
    "SINHALA": "si",
    "TELUGU": "te",
    "KANNADA": "kn",
    "MALAYALAM": "ml",
    "GUJARATI": "gu",
    "ETHIOPIC": "am",
}

# These scripts signal Japanese when found alongside (or instead of) CJK.
_JAPANESE_SCRIPTS = {"HIRAGANA", "KATAKANA", "KATAKANA-HIRAGANA"}


def detect_language_from_text(
    title: str | None = None,
    artist: str | None = None,
) -> str | None:
    """Detect a Whisper language code from the Unicode scripts in title/artist.

    Returns a Whisper ISO-639-1 language code (e.g. ``"he"``, ``"ar"``,
    ``"ja"``) if a non-Latin script dominates the text, or ``None`` if the
    text is Latin/empty (meaning Whisper should auto-detect from audio).
    """
    combined = f"{title or ''} {artist or ''}".strip()
    if not combined:
        return None

    script_counts: Counter[str] = Counter()
    for ch in combined:
        if not unicodedata.category(ch).startswith("L"):
            continue
        try:
            name = unicodedata.name(ch)
        except ValueError:
            continue
        script = name.split()[0]
        script_counts[script] += 1

    if not script_counts:
        return None

    # Remove LATIN — we cannot determine language from Latin script alone.
    script_counts.pop("LATIN", None)
    if not script_counts:
        return None

    # Japanese / Chinese disambiguation:
    # Hiragana or Katakana present -> Japanese.
    # CJK ideographs only (no kana) -> Chinese (Mandarin).
    jp_count = sum(script_counts.get(s, 0) for s in _JAPANESE_SCRIPTS)
    cjk_count = script_counts.get("CJK", 0)

    if jp_count > 0:
        detected = "ja"
    elif cjk_count > 0 and not any(
        s for s in script_counts if s not in ("CJK", "LATIN")
    ):
        detected = "zh"
    else:
        dominant_script = script_counts.most_common(1)[0][0]
        detected = _SCRIPT_TO_WHISPER_LANG.get(dominant_script)

    if detected:
        logger.info(
            "Language detected from text: %s (scripts: %s, title=%r, artist=%r)",
            detected,
            dict(script_counts),
            title,
            artist,
        )

    return detected


def detect_language_from_lyrics(text: str) -> str | None:
    """Detect language from lyrics text using statistical language detection.

    Uses ``langdetect`` to identify the language from actual lyrics content.
    This is especially useful for Latin-script languages (English, Spanish,
    French, etc.) where Unicode script analysis cannot distinguish them.

    Returns a Whisper-compatible ISO-639-1 code or ``None`` on failure.
    """
    if not text or len(text.strip()) < 20:
        return None

    try:
        from langdetect import detect, LangDetectException
    except ImportError:
        logger.warning("langdetect not installed, skipping lyrics-based language detection")
        return None

    try:
        detected = detect(text)
    except LangDetectException:
        logger.warning("langdetect failed to detect language from lyrics")
        return None

    logger.info("Language detected from lyrics: %s (text_length=%d)", detected, len(text))
    return detected
