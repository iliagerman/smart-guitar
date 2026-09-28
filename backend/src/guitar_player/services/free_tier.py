"""Free tier: signed-in members without Pro hear the full mix and the guitar stem."""

from guitar_player.schemas.song import SongDetailResponse, StemUrls

# Stems a free member may play on their own (playback-source).
FREE_STEMS = frozenset({"guitar"})

# Files a free member may stream (/songs/{id}/stream?stem=...).
FREE_STREAM_FILES = frozenset({"audio", "thumbnail", *FREE_STEMS})


def withhold_pro_stems(detail: SongDetailResponse) -> None:
    """Drop every stem URL but the guitar; stem_types keeps advertising them all."""
    detail.stems = StemUrls(guitar=detail.stems.guitar)
    detail.stems_locked = True
