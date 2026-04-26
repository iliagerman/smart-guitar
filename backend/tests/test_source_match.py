"""Tests for the shared source-match gate used by UG and Songsterr fetchers.

The gate decides whether an external search result actually corresponds to
the requested artist/title. Both components (artist + title) must pass
independent thresholds — a perfect title alone (or a perfect artist alone)
is not enough, because that's exactly how wrong-song matches slip through.
"""

from __future__ import annotations

from guitar_player.services.source_match import (
    accept_match,
    component_score,
    match_components,
    normalize,
)


class TestNormalize:
    """Whitespace/case/parenthetical/feat-suffix normalization."""

    def test_lowercase_and_strip(self):
        assert normalize("  Hello World  ") == "hello world"

    def test_strips_parentheticals(self):
        assert normalize("Hello (Acoustic Version)") == "hello"

    def test_strips_brackets(self):
        assert normalize("Hello [Live]") == "hello"

    def test_strips_feat_suffix(self):
        assert normalize("Hello feat. Adele") == "hello"
        assert normalize("Hello ft. Adele") == "hello"
        assert normalize("Hello featuring Adele") == "hello"

    def test_strips_punctuation(self):
        assert normalize("Don't Stop!") == "dont stop"


class TestComponentScore:
    """Per-component (artist OR title) similarity tiers."""

    def test_exact_match_is_one(self):
        assert component_score("Adele", "Adele") == 1.0

    def test_normalized_exact_is_one(self):
        assert component_score("The Beatles", "the beatles") == 1.0

    def test_substring_is_seventy_percent(self):
        # "beatles" is a substring of "the beatles"
        assert component_score("Beatles", "The Beatles") == 0.7
        assert component_score("The Beatles", "Beatles") == 0.7

    def test_word_overlap_partial(self):
        # Half the query words appear in the result.
        score = component_score("hello world", "hello sunshine")
        assert 0 < score < 0.7

    def test_no_overlap_is_zero(self):
        assert component_score("Adele", "Lionel Richie") == 0.0


class TestMatchComponents:
    """match_components returns separate artist/title scores."""

    def test_returns_two_scores(self):
        a, t = match_components("Adele", "Hello", "Adele", "Hello")
        assert a == 1.0
        assert t == 1.0

    def test_wrong_artist_same_title(self):
        # The classic failure case: "Adele - Hello" matched to "Lionel Richie - Hello".
        a, t = match_components(
            "Adele", "Hello", "Lionel Richie", "Hello",
        )
        assert a == 0.0
        assert t == 1.0


class TestAcceptMatch:
    """accept_match enforces both components must clear the threshold."""

    def test_rejects_wrong_artist_even_with_perfect_title(self):
        """The bug we're fixing: wrong artist + perfect title must be rejected."""
        assert accept_match(artist_score=0.0, title_score=1.0) is False

    def test_rejects_wrong_title_even_with_perfect_artist(self):
        assert accept_match(artist_score=1.0, title_score=0.0) is False

    def test_accepts_perfect_match(self):
        assert accept_match(artist_score=1.0, title_score=1.0) is True

    def test_accepts_substring_match(self):
        # "Beatles" in "The Beatles" + exact title.
        assert accept_match(artist_score=0.7, title_score=1.0) is True

    def test_accepts_substring_title(self):
        assert accept_match(artist_score=1.0, title_score=0.7) is True

    def test_rejects_weak_word_overlap(self):
        # 0.4 word overlap is below the 0.7 threshold.
        assert accept_match(artist_score=0.4, title_score=1.0) is False

    def test_rejects_when_both_components_weak(self):
        assert accept_match(artist_score=0.4, title_score=0.4) is False


class TestUGFinderUsesGate:
    """_find_matching_tabs (UG) must apply the per-component gate."""

    def test_rejects_same_title_different_artist(self):
        """Adele's 'Hello' must not match Lionel Richie's 'Hello'."""
        from guitar_player.services.ug_chord_fetcher import _find_matching_tabs

        results = [{
            "type": "Chords",
            "artist_name": "Lionel Richie",
            "song_name": "Hello",
            "rating": 5.0,
            "tab_url": "https://tabs.ultimate-guitar.com/x",
        }]
        matches = _find_matching_tabs(results, "Adele", "Hello", "Chords", 3)
        assert matches == []

    def test_rejects_same_artist_different_title(self):
        from guitar_player.services.ug_chord_fetcher import _find_matching_tabs

        results = [{
            "type": "Chords",
            "artist_name": "Adele",
            "song_name": "Rolling In The Deep",
            "rating": 5.0,
            "tab_url": "https://tabs.ultimate-guitar.com/x",
        }]
        matches = _find_matching_tabs(results, "Adele", "Hello", "Chords", 3)
        assert matches == []

    def test_accepts_substring_artist_match(self):
        """'Beatles' as a substring of 'The Beatles' should still match."""
        from guitar_player.services.ug_chord_fetcher import _find_matching_tabs

        results = [{
            "type": "Chords",
            "artist_name": "The Beatles",
            "song_name": "Let It Be",
            "rating": 4.9,
            "tab_url": "https://tabs.ultimate-guitar.com/x",
        }]
        matches = _find_matching_tabs(results, "Beatles", "Let It Be", "Chords", 3)
        assert len(matches) == 1


class TestSongsterrFinderUsesGate:
    """_find_best_match (Songsterr) must apply the per-component gate."""

    def test_rejects_same_title_different_artist(self):
        from guitar_player.services.external_strum_fetcher import _find_best_match

        results = [{
            "songId": 12345,
            "artist": "Lionel Richie",
            "title": "Hello",
        }]
        match = _find_best_match(results, "Adele", "Hello", "Adele Hello")
        assert match is None

    def test_accepts_perfect_match(self):
        from guitar_player.services.external_strum_fetcher import _find_best_match

        results = [{
            "songId": 12345,
            "artist": "Adele",
            "title": "Hello",
        }]
        match = _find_best_match(results, "Adele", "Hello", "Adele Hello")
        assert match is not None
        assert match["songId"] == 12345
