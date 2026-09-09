"""Correct reversed artist/title pairs only when a music catalog confirms them."""

import logging

import httpx
from pydantic import BaseModel, Field, ValidationError

from guitar_player.services.source_match import normalize

logger = logging.getLogger(__name__)


class CatalogTrack(BaseModel):
    artist: str = Field(alias="artistName")
    title: str = Field(alias="trackName")


class CatalogResponse(BaseModel):
    results: list[CatalogTrack]


async def metadata_is_reversed(artist: str, title: str) -> bool:
    """Require exact normalized matches, and leave ambiguous pairs unchanged."""
    artist = artist.replace("_", " ")
    title = title.replace("_", " ")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                "https://itunes.apple.com/search",
                params={"term": f"{artist} {title}", "entity": "song", "limit": 20},
            )
            response.raise_for_status()
            catalog = CatalogResponse.model_validate_json(response.content)
    except (httpx.HTTPError, ValidationError):
        logger.warning(
            "Music catalog lookup failed for %s / %s", artist, title, exc_info=True
        )
        return False
    pairs = {
        (normalize(track.artist), normalize(track.title)) for track in catalog.results
    }
    current = (normalize(artist), normalize(title))
    reversed_pair = (current[1], current[0])
    return current not in pairs and reversed_pair in pairs
