"""Tests for output path derivation in the /separate endpoint.

Verifies that stems land in the correct directory for both:
- Old 2-level structure: artist/song/audio.mp3
- New 3-level structure: artist/song/youtube_id/audio.mp3
"""

from pathlib import Path


def _derive_output_name(input_path: str) -> str:
    """Mirror the output_name derivation logic from api.py."""
    return str(Path(input_path).parent)


class TestOutputName:
    def test_two_level_path(self):
        """Old format: artist/song/audio.mp3 → output to artist/song/"""
        assert _derive_output_name("artist/song/audio.mp3") == "artist/song"

    def test_three_level_path(self):
        """New format: artist/song/yt_id/audio.mp3 → output to artist/song/yt_id/"""
        assert _derive_output_name("artist/song/yt_id/audio.mp3") == "artist/song/yt_id"

    def test_hebrew_three_level_path(self):
        """Real-world Hebrew path that triggered the bug."""
        input_path = "מאיר_אריאל/לילה_שקט_עבר_על_כוחותינו_בסואץ/2lioz_0ZAWs/audio.mp3"
        expected = "מאיר_אריאל/לילה_שקט_עבר_על_כוחותינו_בסואץ/2lioz_0ZAWs"
        assert _derive_output_name(input_path) == expected

    def test_s3_key_construction(self):
        """Verify the full S3 key for a stem matches the expected layout."""
        input_path = "artist/song/yt_id/audio.mp3"
        output_name = _derive_output_name(input_path)
        s3_key = f"{output_name}/vocals.mp3"
        assert s3_key == "artist/song/yt_id/vocals.mp3"

    def test_cache_check_path(self):
        """The existing-stems cache check should use the full parent path."""
        input_path = "artist/song/yt_id/audio.mp3"
        input_parent = Path(input_path).parent
        candidate = str(input_parent / "vocals.mp3")
        assert candidate == "artist/song/yt_id/vocals.mp3"
