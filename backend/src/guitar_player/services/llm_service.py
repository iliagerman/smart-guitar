"""LLM service — Bedrock-based song name parsing and lyrics cleanup."""

import asyncio
import json
import logging
import re

import boto3
from pydantic import BaseModel

from guitar_player.config import Settings
from guitar_player.services.llm_utils import schema_instruction

logger = logging.getLogger(__name__)


class ParsedSongName(BaseModel):
    artist: str
    song: str
    genre: str = "other"


class ParsedSearchItem(BaseModel):
    """What the LLM returns per search result — artist, song, and genre."""

    artist: str
    song: str
    genre: str = "other"


class LyricsCleanupResult(BaseModel):
    """LLM response identifying the first actual lyrics segment."""

    first_lyrics_index: int


def _to_snake_case(name: str) -> str:
    """Normalize a name to snake_case for filesystem paths."""
    s = name.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s-]+", "_", s)
    return s.strip("_")


MAX_LLM_RETRIES = 3


class LlmService:
    def __init__(self, settings: Settings) -> None:
        self._model_id = settings.llm_models.name_parsing

        kwargs: dict = {"region_name": settings.aws.region}
        if not settings.aws.use_iam_role:
            kwargs["aws_access_key_id"] = settings.aws.access_key
            kwargs["aws_secret_access_key"] = settings.aws.secret_key

        self._client = boto3.client("bedrock-runtime", **kwargs)

    def _converse(self, messages: list[dict]) -> str:
        """Send messages to Bedrock and return the raw text response."""
        response = self._client.converse(
            modelId=self._model_id,
            messages=messages,
        )
        return response["output"]["message"]["content"][0]["text"]

    def _parse_sync(self, video_title: str) -> ParsedSongName:
        """Call Bedrock to extract artist and song from a video title, with retries."""
        prompt = (
            "Extract the artist name and song title from the following YouTube video title.\n\n"
            "Rules:\n"
            "- Strip channel suffixes like VEVO, Official, Topic, etc.\n"
            "- Remove tags like (Official Video), [HD], (Lyrics), (Audio), etc.\n"
            "- Use the canonical/real artist name and song title.\n"
            "- IMPORTANT: Preserve the original language and script. Do NOT transliterate "
            'non-Latin scripts to Latin. For example, keep "מאיר אריאל" as is, '
            'do NOT convert to "meir ariel". Keep "שיר" as is, do NOT write "shir".\n'
            '- If the artist cannot be determined, use "unknown" as the artist.\n'
            "- Use lowercase only for Latin-script text. Non-Latin scripts have no case; "
            "leave them unchanged.\n"
            "- Also classify the genre from this list: rock, pop, metal, country, blues, "
            "jazz, reggae, folk, acoustic, r&b, soft-rock, punk, alternative, indie, "
            'other. If unsure, use "other".\n\n'
            f"{schema_instruction(ParsedSongName)}\n\n"
            f"Video title: {video_title}"
        )

        messages: list[dict] = [
            {"role": "user", "content": [{"text": prompt}]},
        ]

        for attempt in range(MAX_LLM_RETRIES):
            raw_text = self._converse(messages)

            try:
                json_match = re.search(r"\{.*\}", raw_text, re.DOTALL)
                if not json_match:
                    raise ValueError(f"No JSON found in LLM response: {raw_text}")

                parsed = ParsedSongName.model_validate_json(json_match.group())

                return ParsedSongName(
                    artist=_to_snake_case(parsed.artist),
                    song=_to_snake_case(parsed.song),
                    genre=parsed.genre.lower().strip(),
                )
            except Exception as e:
                logger.warning(
                    "LLM parse attempt %d/%d failed: %s",
                    attempt + 1,
                    MAX_LLM_RETRIES,
                    e,
                )
                if attempt < MAX_LLM_RETRIES - 1:
                    # Feed the error back so the LLM can correct itself
                    messages.append(
                        {"role": "assistant", "content": [{"text": raw_text}]}
                    )
                    messages.append(
                        {
                            "role": "user",
                            "content": [
                                {
                                    "text": (
                                        f"Your response could not be parsed: {e}\n\n"
                                        'Please return ONLY a JSON object with "artist", "song", '
                                        'and "genre" string fields containing the actual values '
                                        "extracted from the video title. Do NOT return a JSON schema "
                                        "or type definitions. "
                                        'Example: {"artist": "eagles", "song": "hotel california", '
                                        '"genre": "rock"}'
                                    )
                                }
                            ],
                        },
                    )
                else:
                    raise

        raise RuntimeError("Unreachable")

    async def parse_song_name(self, video_title: str) -> ParsedSongName:
        """Parse a YouTube video title into artist/song via Bedrock LLM."""
        return await asyncio.to_thread(self._parse_sync, video_title)

    def _parse_search_results_sync(
        self, search_results: list[dict]
    ) -> list[ParsedSearchItem]:
        """Send all search results to LLM in one batch call, get back parsed items."""
        titles_block = "\n".join(
            f"{i + 1}. {r.get('title', '')}" for i, r in enumerate(search_results)
        )

        prompt = (
            "You are given a numbered list of YouTube video titles.\n"
            "For each title, extract the artist name, song title, and classify the genre.\n\n"
            "Rules:\n"
            "- Strip channel suffixes like VEVO, Official, Topic, etc.\n"
            "- Remove tags like (Official Video), [HD], (Lyrics), (Audio), etc.\n"
            "- Use the canonical/real artist name and song title.\n"
            "- IMPORTANT: Preserve the original language and script. Do NOT transliterate "
            'non-Latin scripts to Latin. For example, keep "מאיר אריאל" as is, '
            'do NOT convert to "meir ariel". Keep "שיר" as is, do NOT write "shir".\n'
            "- Use lowercase only for Latin-script text. Non-Latin scripts have no case; "
            "leave them unchanged.\n"
            '- If the artist cannot be determined, use "unknown" as the artist.\n'
            "- Classify the genre from this list: rock, pop, metal, country, blues, "
            "jazz, reggae, folk, acoustic, r&b, soft-rock, punk, alternative, indie, "
            'other. If unsure, use "other".\n'
            "- Return results in the SAME ORDER as the input list.\n"
            f"- Return exactly {len(search_results)} items.\n\n"
            f"{schema_instruction(ParsedSearchItem, is_list=True)}\n\n"
            f"Video titles:\n{titles_block}"
        )

        messages: list[dict] = [
            {"role": "user", "content": [{"text": prompt}]},
        ]

        for attempt in range(MAX_LLM_RETRIES):
            raw_text = self._converse(messages)

            try:
                json_match = re.search(r"\[.*\]", raw_text, re.DOTALL)
                if not json_match:
                    raise ValueError(f"No JSON array found in LLM response: {raw_text}")

                raw_list = json.loads(json_match.group())
                parsed = [ParsedSearchItem.model_validate(item) for item in raw_list]

                return [
                    ParsedSearchItem(
                        artist=_to_snake_case(item.artist) or "unknown_artist",
                        song=_to_snake_case(item.song),
                        genre=item.genre.lower().strip(),
                    )
                    for item in parsed
                ]
            except Exception as e:
                logger.warning(
                    "LLM batch parse attempt %d/%d failed: %s",
                    attempt + 1,
                    MAX_LLM_RETRIES,
                    e,
                )
                if attempt < MAX_LLM_RETRIES - 1:
                    messages.append(
                        {"role": "assistant", "content": [{"text": raw_text}]}
                    )
                    messages.append(
                        {
                            "role": "user",
                            "content": [
                                {
                                    "text": (
                                        f"Your response could not be parsed: {e}\n\n"
                                        "Please return ONLY a JSON array of objects, each with "
                                        '"artist", "song", and "genre" string fields containing '
                                        "the actual values extracted from the video titles. Do NOT "
                                        "return JSON schema definitions or type descriptions. "
                                        'Example: [{"artist": "eagles", "song": "hotel california", '
                                        '"genre": "rock"}]'
                                    )
                                }
                            ],
                        },
                    )
                else:
                    raise

        raise RuntimeError("Unreachable")

    async def parse_search_results(
        self, search_results: list[dict]
    ) -> list[ParsedSearchItem]:
        """Parse a batch of YouTube search results into artist/song via Bedrock LLM."""
        return await asyncio.to_thread(self._parse_search_results_sync, search_results)

    # ---- Lyrics preamble cleanup ----

    _MAX_PREAMBLE_CHECK = 15

    def _cleanup_lyrics_preamble_sync(self, segment_texts: list[str]) -> int:
        """Identify the index of the first actual lyrics segment.

        Returns 0 if the first segment is already lyrics (no removal needed).
        """
        check_count = min(len(segment_texts), self._MAX_PREAMBLE_CHECK)
        texts_block = "\n".join(
            f'{i}: "{t}"' for i, t in enumerate(segment_texts[:check_count])
        )

        prompt = (
            "You are analyzing the beginning of a song lyrics transcription.\n"
            "Some initial segments may contain non-lyrics content that was accidentally "
            "captured by the speech-to-text model.\n\n"
            "Non-lyrics content includes: copyright notices, URLs, website addresses, "
            "disclaimers, channel names, recording information, ads, legal text, "
            "or any text that is clearly not part of a song's lyrics.\n\n"
            "Actual lyrics are words/phrases from a song (verses, chorus, bridges, etc.).\n\n"
            "Identify the 0-based index of the FIRST segment that contains actual song lyrics. "
            "All segments before that index will be removed.\n\n"
            "Rules:\n"
            "- If segment 0 already contains lyrics, return 0.\n"
            f"- If ALL {check_count} segments are non-lyrics, return {check_count}.\n"
            "- When in doubt, treat a segment as lyrics (prefer keeping content).\n\n"
            f"{schema_instruction(LyricsCleanupResult)}\n\n"
            f"Segments:\n{texts_block}"
        )

        messages: list[dict] = [
            {"role": "user", "content": [{"text": prompt}]},
        ]

        for attempt in range(MAX_LLM_RETRIES):
            raw_text = self._converse(messages)

            try:
                json_match = re.search(r"\{.*\}", raw_text, re.DOTALL)
                if not json_match:
                    raise ValueError(f"No JSON found in LLM response: {raw_text}")

                parsed = LyricsCleanupResult.model_validate_json(json_match.group())
                # Clamp to valid range
                return max(0, min(parsed.first_lyrics_index, check_count))
            except Exception as e:
                logger.warning(
                    "LLM lyrics cleanup attempt %d/%d failed: %s",
                    attempt + 1,
                    MAX_LLM_RETRIES,
                    e,
                )
                if attempt < MAX_LLM_RETRIES - 1:
                    messages.append(
                        {"role": "assistant", "content": [{"text": raw_text}]}
                    )
                    messages.append(
                        {
                            "role": "user",
                            "content": [
                                {
                                    "text": (
                                        f"Your response could not be parsed: {e}\n\n"
                                        "Please return ONLY a JSON object with a "
                                        '"first_lyrics_index" integer field. '
                                        'Example: {"first_lyrics_index": 3}'
                                    )
                                }
                            ],
                        },
                    )
                else:
                    raise

        raise RuntimeError("Unreachable")

    async def cleanup_lyrics_preamble(self, segment_texts: list[str]) -> int:
        """Identify the first actual lyrics segment index via Bedrock LLM."""
        return await asyncio.to_thread(
            self._cleanup_lyrics_preamble_sync, segment_texts
        )
