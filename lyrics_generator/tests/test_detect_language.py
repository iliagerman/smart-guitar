"""Tests for Unicode script-based language detection."""

import pytest

from lyrics_generator.detect_language import detect_language_from_text


class TestDetectLanguageFromText:

    # --- Hebrew ---
    def test_hebrew_title_and_artist(self):
        assert detect_language_from_text(title="ניצוצות", artist="פורטיסחרוף") == "he"

    def test_hebrew_title_only(self):
        assert detect_language_from_text(title="שיר", artist=None) == "he"

    def test_hebrew_artist_only(self):
        assert detect_language_from_text(title=None, artist="עידן רייכל") == "he"

    def test_hebrew_with_some_latin(self):
        assert detect_language_from_text(title="ניצוצות (Live)", artist="פורטיסחרוף") == "he"

    # --- Arabic ---
    def test_arabic(self):
        assert detect_language_from_text(title="مرحبا", artist="فيروز") == "ar"

    # --- CJK / Chinese ---
    def test_chinese_cjk_only(self):
        assert detect_language_from_text(title="月亮代表我的心", artist="邓丽君") == "zh"

    # --- Japanese ---
    def test_japanese_hiragana(self):
        assert detect_language_from_text(title="さくら", artist=None) == "ja"

    def test_japanese_katakana(self):
        assert detect_language_from_text(title="カタカナ", artist=None) == "ja"

    def test_japanese_mixed_cjk_and_kana(self):
        assert detect_language_from_text(title="東京タワー", artist=None) == "ja"

    # --- Korean ---
    def test_korean(self):
        assert detect_language_from_text(title="안녕하세요", artist=None) == "ko"

    # --- Cyrillic ---
    def test_cyrillic(self):
        assert detect_language_from_text(title="Привет", artist="Кино") == "ru"

    # --- Greek ---
    def test_greek(self):
        assert detect_language_from_text(title="Ελλάδα", artist=None) == "el"

    # --- Thai ---
    def test_thai(self):
        assert detect_language_from_text(title="สวัสดี", artist=None) == "th"

    # --- Georgian ---
    def test_georgian(self):
        assert detect_language_from_text(title="საქართველო", artist=None) == "ka"

    # --- Latin (should return None) ---
    def test_english_returns_none(self):
        assert detect_language_from_text(title="Hello World", artist="Bob Dylan") is None

    def test_french_returns_none(self):
        assert detect_language_from_text(title="La Vie en Rose", artist="Edith Piaf") is None

    # --- Empty / None ---
    def test_none_inputs(self):
        assert detect_language_from_text(title=None, artist=None) is None

    def test_empty_strings(self):
        assert detect_language_from_text(title="", artist="") is None

    def test_whitespace_only(self):
        assert detect_language_from_text(title="   ", artist="  ") is None

    # --- Digits / punctuation only ---
    def test_digits_only(self):
        assert detect_language_from_text(title="12345", artist="67890") is None
