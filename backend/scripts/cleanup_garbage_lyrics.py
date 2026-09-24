"""Remove lyrics Whisper transcribed from something other than the singing.

Some songs were transcribed from YouTube boilerplate rather than vocals --
"Hit Like, Comment, and Subscribe", a university copyright notice, a film
festival credit, or just the letter "a" 65 times. The vocal-activity gate in
backfill_unvoiced_lyrics.py cannot catch these: the text sits over real audio,
it is simply not the song.

There is no rule that separates these from real lyrics, so the affected songs
are listed explicitly below, each one read and classified by hand.

Three outcomes:
  FALL_BACK  delete lyrics.json, so the player falls through to the correct
             lyrics already stored in lyrics_quick.json (the "Online" source)
  NO_LYRICS  delete both, because every source for this song is junk or the
             track is an instrumental -- it becomes a chord sheet
  STRIP_LINE drop one junk line from otherwise-correct lyrics

Usage:
    cd backend && APP_ENV=prod uv run python scripts/cleanup_garbage_lyrics.py
    cd backend && APP_ENV=prod uv run python scripts/cleanup_garbage_lyrics.py --apply
"""

import argparse
import logging
import sys

from guitar_player.config import load_settings
from guitar_player.storage import StorageBackend, create_storage

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

BACKUP_NAME = "lyrics.pre_vad.json"

# Whisper transcribed boilerplate; lyrics_quick.json holds the real words.
FALL_BACK = [
    "daft_punk/harder_better_faster_stronger",
    "daft_punk/something_about_us",
    "depeche_mode/policy_of_truth",
    "desmond_dekker/007_shanty_town",
    "ehud_banai/cameron",
    "glass_animals/tokyo_drifting",
    "godsmack/awake",
    "godsmack/i_stand_alone",
    "harry_styles/aperture",
    "john_mayer/slow_dancing_in_a_burning_room",
    "jose_gonzalez/stay_alive",
    "keane/bedshaped",
    "led_zeppelin/stairway_to_heaven",
    "meir_ariel/lo_nora",
    "mumford_sons/the_cave",
    "new_order/true_faith",
    "sam_smith/stay_with_me",
    "sex_pistols/bodies",
    "shalom_hanoch/mechakim_la_mashiach",
    "simon_garfunkel/the_sound_of_silence",
    "the_bones_of_jr_jones/burden",
    "the_bones_of_jr_jones/heaven_help_me",
    "the_bones_of_jr_jones/trouble",
    "the_kid_laroi_justin_bieber/stay",
    "the_offspring/come_out_and_play",
    "the_temptations/papa_was_a_rollin_stone",
    "the_verve/bitter_sweet_symphony",
    "u2/where_the_streets_have_no_name",
    "הפרוייקט_של_עידן_רייכל/ממעמקים",
]

# Solo piano, so no lyrics exist to find; and one song where Genius returned
# an album list instead of words.
NO_LYRICS = [
    "franz_liszt/consolations_s_172_no_3_in_d-flat_major_lento_placido",
    "franz_liszt_daniel_barenboim/consolations_s_172_no_3_in_d-flat_major_lento_placido",
    "the_1975/raindance",
]

# Correct lyrics carrying one transcription artifact. The player already hides
# segments starting with http://, which is why these bare hostnames survived.
STRIP_LINE = {
    "damien_rice/cannonball": "www.mooji.org",
    "david_bowie/ziggy_stardust": "ZiggyTruth.blogspot.com",
    "jeff_buckley/last_goodbye": "University of Georgia",
    "rage_against_the_machine/killing_in_the_name": "www.thevenusproject.com",
}


def _back_up(storage: StorageBackend, song: str, apply: bool) -> None:
    """Keep the original beside the song; the audio bucket is not versioned."""
    backup_key = f"{song}/{BACKUP_NAME}"
    if storage.file_exists(backup_key):
        return
    if apply:
        storage.write_json(backup_key, storage.read_json(f"{song}/lyrics.json"))


def _delete(storage: StorageBackend, key: str, apply: bool) -> bool:
    if not storage.file_exists(key):
        return False
    if apply:
        storage.delete_file(key)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    args = parser.parse_args()

    storage = create_storage(load_settings())
    storage.init()
    mode = "APPLY" if args.apply else "DRY RUN"
    logger.info("%s\n", mode)

    deleted = stripped = missing = 0

    logger.info("FALL_BACK -- delete lyrics.json, Online lyrics take over:")
    for song in FALL_BACK:
        _back_up(storage, song, args.apply)
        if _delete(storage, f"{song}/lyrics.json", args.apply):
            deleted += 1
            logger.info("  removed lyrics.json   %s", song)
        else:
            missing += 1
            logger.info("  ALREADY GONE          %s", song)

    logger.info("\nNO_LYRICS -- delete both sources, song becomes a chord sheet:")
    for song in NO_LYRICS:
        _back_up(storage, song, args.apply)
        for name in ("lyrics.json", "lyrics_quick.json"):
            if _delete(storage, f"{song}/{name}", args.apply):
                deleted += 1
                logger.info("  removed %-18s %s", name, song)

    logger.info("\nSTRIP_LINE -- drop one junk line, keep the rest:")
    for song, needle in STRIP_LINE.items():
        key = f"{song}/lyrics.json"
        payload = storage.read_json(key)
        segments = payload["segments"]
        kept = [s for s in segments if needle not in s["text"]]
        removed = len(segments) - len(kept)
        if not removed:
            logger.info("  NOTHING MATCHED       %s (%r)", song, needle)
            continue
        _back_up(storage, song, args.apply)
        if args.apply:
            payload["segments"] = kept
            storage.write_json(key, payload)
        stripped += removed
        logger.info("  dropped %d line(s)     %s (%r)", removed, song, needle)

    logger.info("\n%s complete", mode)
    logger.info("  lyrics files deleted : %d", deleted)
    logger.info("  junk lines stripped  : %d", stripped)
    logger.info("  already absent       : %d", missing)
    if not args.apply:
        logger.info("  re-run with --apply to write these changes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
