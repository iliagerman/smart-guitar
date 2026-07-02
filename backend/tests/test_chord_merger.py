"""Tests for chord_merger.merge_chord_meta.

The autochord pipeline writes ``bpm``/``bar_starts`` into chord_meta.json so
the bars view / strum grid can render measures. The Gemini enrichment path
writes its own ``capo``/``key``/``bpm``/etc. into the *same* file and must not
silently clobber fields it doesn't know about.
"""

from guitar_player.services.chord_merger import ChordMeta, merge_chord_meta


def test_merge_preserves_bar_starts_from_autochord():
    """Gemini metadata must not drop bar_starts written by the autochord path."""
    existing = {"bpm": 120.0, "bar_starts": [0.0, 2.0, 4.0, 6.0]}
    meta = ChordMeta(capo=2, key="G", bpm=121, source="gemini")

    merged = merge_chord_meta(existing, meta)

    assert merged["bar_starts"] == [0.0, 2.0, 4.0, 6.0]


def test_merge_applies_new_gemini_fields():
    """Non-None Gemini fields overwrite the corresponding existing keys."""
    existing = {"bpm": 120.0, "bar_starts": [0.0, 2.0]}
    meta = ChordMeta(capo=2, key="G", bpm=121, tuning="Drop D", source="gemini")

    merged = merge_chord_meta(existing, meta)

    assert merged["capo"] == 2
    assert merged["key"] == "G"
    assert merged["bpm"] == 121
    assert merged["tuning"] == "Drop D"
    assert merged["source"] == "gemini"


def test_merge_with_no_existing_meta_returns_gemini_fields_only():
    """When no chord_meta.json existed yet, merge behaves like a plain write."""
    meta = ChordMeta(key="Em", source="gemini")

    merged = merge_chord_meta({}, meta)

    assert merged == {"key": "Em", "source": "gemini"}
    assert "bar_starts" not in merged


def test_merge_omits_none_fields_but_keeps_existing_values():
    """Fields Gemini didn't detect (None) must not erase existing values."""
    existing = {"capo": 3, "key": "D", "bar_starts": [0.0, 1.5]}
    meta = ChordMeta(source="gemini")  # capo/key left unset -> None

    merged = merge_chord_meta(existing, meta)

    assert merged["capo"] == 3
    assert merged["key"] == "D"
    assert merged["bar_starts"] == [0.0, 1.5]
    assert merged["source"] == "gemini"
