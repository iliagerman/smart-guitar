"""Integration check against the live iTunes catalog."""

import asyncio

from guitar_player.services.song_metadata import metadata_is_reversed


async def main() -> None:
    assert await metadata_is_reversed("Apocalypse", "Pleasantries")
    assert not await metadata_is_reversed("Pleasantries", "Apocalypse")
    assert not await metadata_is_reversed("The Beatles", "Yesterday")
    print("PASS: reversed metadata corrected; canonical artist/title pairs preserved")


if __name__ == "__main__":
    asyncio.run(main())
