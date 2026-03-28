"""Tests for tutorial link scoring, language detection, and YouTube fallback."""

from unittest.mock import MagicMock, patch

import pytest

from guitar_player.services.job_service import (
    _score_tutorial_link,
    _search_youtube_tutorial,
)
from guitar_player.services.llm_service import (
    _detect_language,
    _tutorial_search_suffix,
    TutorialLink,
)


# ── _detect_language ─────────────────────────────────────────────


class TestDetectLanguage:
    def test_hebrew(self):
        assert _detect_language("שלמה ארצי") == "hebrew"

    def test_arabic(self):
        assert _detect_language("أغنية عربية") == "arabic"

    def test_russian(self):
        assert _detect_language("Русская песня") == "russian"

    def test_japanese_hiragana(self):
        assert _detect_language("こんにちは") == "japanese"

    def test_japanese_katakana(self):
        assert _detect_language("カタカナ") == "japanese"

    def test_korean(self):
        assert _detect_language("한국어 노래") == "korean"

    def test_chinese(self):
        assert _detect_language("中文歌曲") == "chinese"

    def test_thai(self):
        assert _detect_language("เพลงไทย") == "thai"

    def test_greek(self):
        assert _detect_language("Ελληνικά") == "greek"

    def test_spanish_diacritic(self):
        assert _detect_language("Canción española") == "spanish"

    def test_turkish_diacritic(self):
        assert _detect_language("şarkı güzel") == "turkish"

    def test_german_diacritic(self):
        assert _detect_language("Über alles") == "german"

    def test_french_diacritic(self):
        assert _detect_language("Chanson très belle") == "french"

    def test_english_default(self):
        assert _detect_language("Some English Song") == "english"

    def test_mixed_hebrew_english(self):
        # Hebrew characters should be detected even if mixed with Latin
        assert _detect_language("Song שלמה") == "hebrew"

    def test_empty_string(self):
        assert _detect_language("") == "english"


# ── _tutorial_search_suffix ──────────────────────────────────────


class TestTutorialSearchSuffix:
    def test_hebrew_includes_native_and_english(self):
        suffix = _tutorial_search_suffix("שיר עברי", "זמר עברי")
        assert "שיעור גיטרה" in suffix
        assert "guitar tutorial" in suffix

    def test_english_only_english(self):
        suffix = _tutorial_search_suffix("Wonderwall", "Oasis")
        assert "guitar tutorial" in suffix
        # Should NOT contain non-English terms
        assert "שיעור" not in suffix

    def test_russian_includes_native(self):
        suffix = _tutorial_search_suffix("Песня", "Исполнитель")
        assert "урок гитары" in suffix
        assert "guitar tutorial" in suffix

    def test_arabic_includes_native(self):
        suffix = _tutorial_search_suffix("أغنية", "فنان")
        assert "تعليم جيتار" in suffix
        assert "guitar tutorial" in suffix

    def test_japanese_includes_native(self):
        suffix = _tutorial_search_suffix("さくら", "アーティスト")
        assert "ギター" in suffix
        assert "guitar tutorial" in suffix

    def test_korean_includes_native(self):
        suffix = _tutorial_search_suffix("노래", "가수")
        assert "기타 레슨" in suffix
        assert "guitar tutorial" in suffix


# ── _score_tutorial_link ─────────────────────────────────────────


class TestScoreTutorialLink:
    def test_tutorial_in_title_scores_positive(self):
        score = _score_tutorial_link("How to play Wonderwall guitar tutorial", "https://youtube.com/watch?v=abc")
        assert score > 0

    def test_music_video_scores_negative(self):
        score = _score_tutorial_link("Wonderwall Official Music Video", "https://youtube.com/watch?v=abc")
        assert score < 0

    def test_tutorial_beats_music_video(self):
        tutorial_score = _score_tutorial_link(
            "How to play Wonderwall - guitar tutorial lesson",
            "https://youtube.com/watch?v=abc",
        )
        video_score = _score_tutorial_link(
            "Oasis - Wonderwall (Official Video)",
            "https://youtube.com/watch?v=xyz",
        )
        assert tutorial_score > video_score

    def test_domain_bonus(self):
        score_with_domain = _score_tutorial_link("Guitar lesson", "https://justinguitar.com/lesson/123")
        score_without_domain = _score_tutorial_link("Guitar lesson", "https://youtube.com/watch?v=abc")
        assert score_with_domain > score_without_domain

    def test_hebrew_tutorial_keywords(self):
        score = _score_tutorial_link("שיעור גיטרה - אקורדים לשיר", "https://youtube.com/watch?v=abc")
        assert score > 0

    def test_hebrew_music_video_keywords(self):
        score = _score_tutorial_link("קליפ רשמי - הופעה חיה", "https://youtube.com/watch?v=abc")
        assert score < 0

    def test_hebrew_tutorial_vs_clip(self):
        tutorial_score = _score_tutorial_link(
            "שיעור גיטרה - איך לנגן את השיר",
            "https://youtube.com/watch?v=abc",
        )
        clip_score = _score_tutorial_link(
            "קליפ רשמי - שלמה ארצי",
            "https://youtube.com/watch?v=xyz",
        )
        assert tutorial_score > clip_score

    def test_neutral_title_scores_zero(self):
        score = _score_tutorial_link("Some Random Title", "https://youtube.com/watch?v=abc")
        assert score == 0

    def test_case_insensitive(self):
        score = _score_tutorial_link("GUITAR TUTORIAL LESSON", "https://youtube.com/watch?v=abc")
        assert score > 0

    def test_multiple_positive_keywords_stack(self):
        score_one = _score_tutorial_link("tutorial", "https://youtube.com/watch?v=abc")
        score_many = _score_tutorial_link("guitar tutorial lesson chords beginner", "https://youtube.com/watch?v=abc")
        assert score_many > score_one

    def test_vevo_is_negative(self):
        score = _score_tutorial_link("Artist - Song (Vevo)", "https://youtube.com/watch?v=abc")
        assert score < 0

    def test_karaoke_is_negative(self):
        score = _score_tutorial_link("Song Name - Karaoke Version", "https://youtube.com/watch?v=abc")
        assert score < 0

    def test_spanish_tutorial_keywords(self):
        score = _score_tutorial_link("Tutorial de guitarra - cómo tocar acordes", "https://youtube.com/watch?v=abc")
        assert score > 0

    def test_russian_tutorial_keywords(self):
        score = _score_tutorial_link("Урок гитары - как играть аккорды", "https://youtube.com/watch?v=abc")
        assert score > 0

    def test_ultimate_guitar_domain(self):
        score = _score_tutorial_link("Song chords", "https://ultimate-guitar.com/tab/123")
        assert score > 0


# ── _search_youtube_tutorial (with mocked yt-dlp) ────────────────


class TestSearchYoutubeTutorial:
    @pytest.mark.asyncio
    async def test_picks_best_tutorial_from_results(self):
        mock_entries = [
            {"id": "vid1", "title": "שלמה ארצי - קליפ רשמי"},
            {"id": "vid2", "title": "שיעור גיטרה - שלמה ארצי אקורדים"},
            {"id": "vid3", "title": "שלמה ארצי הופעה חיה"},
        ]
        mock_result = {"entries": mock_entries}

        mock_ydl = MagicMock()
        mock_ydl.extract_info.return_value = mock_result
        mock_ydl.__enter__ = MagicMock(return_value=mock_ydl)
        mock_ydl.__exit__ = MagicMock(return_value=False)

        with patch("yt_dlp.YoutubeDL") as mock_yt_dlp_cls:
            mock_yt_dlp_cls.return_value = mock_ydl
            url, _links = await _search_youtube_tutorial("שיר", "שלמה ארצי")

        assert url == "https://www.youtube.com/watch?v=vid2"

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_results(self):
        mock_result = {"entries": []}

        mock_ydl = MagicMock()
        mock_ydl.extract_info.return_value = mock_result
        mock_ydl.__enter__ = MagicMock(return_value=mock_ydl)
        mock_ydl.__exit__ = MagicMock(return_value=False)

        with patch("yt_dlp.YoutubeDL") as mock_yt_dlp_cls:
            mock_yt_dlp_cls.return_value = mock_ydl
            url, _links = await _search_youtube_tutorial("Unknown Song", "Unknown Artist")

        assert url == ""

    @pytest.mark.asyncio
    async def test_returns_empty_on_exception(self):
        mock_ydl = MagicMock()
        mock_ydl.extract_info.side_effect = Exception("Network error")
        mock_ydl.__enter__ = MagicMock(return_value=mock_ydl)
        mock_ydl.__exit__ = MagicMock(return_value=False)

        with patch("yt_dlp.YoutubeDL") as mock_yt_dlp_cls:
            mock_yt_dlp_cls.return_value = mock_ydl
            url, _links = await _search_youtube_tutorial("Song", "Artist")

        assert url == ""

    @pytest.mark.asyncio
    async def test_english_song_uses_english_query(self):
        mock_result = {"entries": [{"id": "vid1", "title": "Guitar tutorial"}]}

        mock_ydl = MagicMock()
        mock_ydl.extract_info.return_value = mock_result
        mock_ydl.__enter__ = MagicMock(return_value=mock_ydl)
        mock_ydl.__exit__ = MagicMock(return_value=False)

        with patch("yt_dlp.YoutubeDL") as mock_yt_dlp_cls:
            mock_yt_dlp_cls.return_value = mock_ydl
            await _search_youtube_tutorial("Wonderwall", "Oasis")

        # Verify the search query contains English terms
        call_args = mock_ydl.extract_info.call_args
        query = call_args[0][0]
        assert "guitar tutorial" in query
        assert "Wonderwall" in query
        assert "Oasis" in query

    @pytest.mark.asyncio
    async def test_hebrew_song_uses_hebrew_query(self):
        mock_result = {"entries": [{"id": "vid1", "title": "שיעור גיטרה"}]}

        mock_ydl = MagicMock()
        mock_ydl.extract_info.return_value = mock_result
        mock_ydl.__enter__ = MagicMock(return_value=mock_ydl)
        mock_ydl.__exit__ = MagicMock(return_value=False)

        with patch("yt_dlp.YoutubeDL") as mock_yt_dlp_cls:
            mock_yt_dlp_cls.return_value = mock_ydl
            await _search_youtube_tutorial("שיר עברי", "זמר עברי")

        call_args = mock_ydl.extract_info.call_args
        query = call_args[0][0]
        assert "שיעור גיטרה" in query
        assert "guitar tutorial" in query

    @pytest.mark.asyncio
    async def test_picks_tutorial_over_song_among_all_negative(self):
        """When all results look like non-tutorials, pick the least negative."""
        mock_entries = [
            {"id": "vid1", "title": "Artist - Song Official Music Video Vevo"},
            {"id": "vid2", "title": "Artist - Song Live Concert"},
            {"id": "vid3", "title": "Artist - Song"},  # neutral, should win
        ]
        mock_result = {"entries": mock_entries}

        mock_ydl = MagicMock()
        mock_ydl.extract_info.return_value = mock_result
        mock_ydl.__enter__ = MagicMock(return_value=mock_ydl)
        mock_ydl.__exit__ = MagicMock(return_value=False)

        with patch("yt_dlp.YoutubeDL") as mock_yt_dlp_cls:
            mock_yt_dlp_cls.return_value = mock_ydl
            url, _links = await _search_youtube_tutorial("Song", "Artist")

        # vid3 is neutral (score=0), others are negative
        assert url == "https://www.youtube.com/watch?v=vid3"


# ── Integration: tutorial link selection within strum flow ────────


class TestTutorialLinkSelectionInStrumFlow:
    """Test that the scored selection logic picks the right link from a list."""

    def test_selects_best_from_mixed_links(self):
        """Simulate the selection logic from job_service."""
        links = [
            TutorialLink(url="https://youtube.com/watch?v=song1", title="Artist - Song Official Video"),
            TutorialLink(url="https://youtube.com/watch?v=tut1", title="How to play Song - Guitar Tutorial Chords"),
            TutorialLink(url="https://youtube.com/watch?v=live1", title="Artist Live Concert 2024"),
        ]

        youtube_links = [l for l in links if "youtube.com" in l.url or "youtu.be" in l.url]
        scored = [(l, _score_tutorial_link(l.title, l.url)) for l in youtube_links]
        scored.sort(key=lambda x: x[1], reverse=True)
        best_link, best_score = scored[0]

        assert best_link.url == "https://youtube.com/watch?v=tut1"
        assert best_score > 0

    def test_selects_best_hebrew_tutorial(self):
        links = [
            TutorialLink(url="https://youtube.com/watch?v=clip1", title="שלמה ארצי - קליפ רשמי"),
            TutorialLink(url="https://youtube.com/watch?v=lesson1", title="שיעור גיטרה - שלמה ארצי - אקורדים ופריטה"),
        ]

        youtube_links = [l for l in links if "youtube.com" in l.url or "youtu.be" in l.url]
        scored = [(l, _score_tutorial_link(l.title, l.url)) for l in youtube_links]
        scored.sort(key=lambda x: x[1], reverse=True)
        best_link, _ = scored[0]

        assert best_link.url == "https://youtube.com/watch?v=lesson1"

    def test_non_youtube_links_filtered_out(self):
        links = [
            TutorialLink(url="https://justinguitar.com/lesson/123", title="Guitar Lesson"),
            TutorialLink(url="https://guitartricks.com/lesson/456", title="Guitar Tutorial"),
        ]

        youtube_links = [l for l in links if "youtube.com" in l.url or "youtu.be" in l.url]
        assert len(youtube_links) == 0

    def test_empty_links_list(self):
        links: list[TutorialLink] = []
        youtube_links = [l for l in links if "youtube.com" in l.url or "youtu.be" in l.url]
        assert len(youtube_links) == 0
