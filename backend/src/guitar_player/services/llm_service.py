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


class StrumPatternSection(BaseModel):
    """A strumming pattern for one song section."""

    section: str  # e.g. "Verse", "Chorus", "Bridge"
    pattern: list[str]  # e.g. ["down", "down", "down", "down", "up"]


class TutorialLink(BaseModel):
    """A YouTube or tutorial link found via web search."""

    url: str
    title: str = ""


class StrumPatternResult(BaseModel):
    """LLM response with strumming patterns for a song."""

    sections: list[StrumPatternSection]
    bpm: int = 0
    notes: str = ""  # any extra notes like "accent beat 1"
    tutorial_links: list[TutorialLink] = []  # populated from Tavily, not LLM


class LyricsCleanupResult(BaseModel):
    """LLM response identifying the first actual lyrics segment."""

    first_lyrics_index: int


class LyricsSegmentMapping(BaseModel):
    """Maps one quick lyrics segment to a contiguous range of regular segments."""

    quick_index: int
    regular_start_index: int
    regular_end_index: int
    confidence: float = 0.0


def _to_snake_case(name: str) -> str:
    """Normalize a name to snake_case for filesystem paths."""
    s = name.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s-]+", "_", s)
    return s.strip("_")


MAX_LLM_RETRIES = 3

# ---------------------------------------------------------------------------
# Language-aware search terms for Tavily tutorial queries
# ---------------------------------------------------------------------------
_TUTORIAL_SEARCH_TERMS: dict[str, str] = {
    "hebrew": "שיעור גיטרה אקורדים",
    "arabic": "تعليم جيتار أكوردات",
    "russian": "урок гитары аккорды",
    "japanese": "ギター 弾き方 コード",
    "korean": "기타 레슨 코드",
    "chinese": "吉他教学 和弦",
    "thai": "สอนกีตาร์ คอร์ด",
    "greek": "μάθημα κιθάρας συγχορδίες",
    "turkish": "gitar dersi akorlar",
    "spanish": "tutorial guitarra acordes",
    "portuguese": "aula violão acordes",
    "french": "tutoriel guitare accords",
    "german": "gitarre tutorial akkorde",
}

# Unicode block ranges to detect script/language from text
_SCRIPT_RANGES: list[tuple[int, int, str]] = [
    (0x0590, 0x05FF, "hebrew"),
    (0x0600, 0x06FF, "arabic"),
    (0x0750, 0x077F, "arabic"),
    (0x0400, 0x04FF, "russian"),
    (0x3040, 0x309F, "japanese"),   # Hiragana
    (0x30A0, 0x30FF, "japanese"),   # Katakana
    (0x4E00, 0x9FFF, "chinese"),    # CJK Unified
    (0xAC00, 0xD7AF, "korean"),
    (0x0E00, 0x0E7F, "thai"),
    (0x0370, 0x03FF, "greek"),
]

# Latin-script languages detected by common character patterns
_LATIN_LANG_MARKERS: list[tuple[str, str]] = [
    # Unique markers first (unambiguous), then shared ones as fallback
    ("ş", "turkish"),
    ("ğ", "turkish"),
    ("ı", "turkish"),
    ("ñ", "spanish"),
    ("ä", "german"),
    ("ü", "german"),
    ("ö", "german"),
    ("ç", "portuguese"),   # also French/Turkish but good enough
    ("é", "french"),
    ("è", "french"),
    ("ê", "french"),
]


def _detect_language(text: str) -> str:
    """Detect language from text using Unicode script ranges. Returns language key or 'english'."""
    for ch in text:
        cp = ord(ch)
        for lo, hi, lang in _SCRIPT_RANGES:
            if lo <= cp <= hi:
                return lang
    # Check Latin-script diacritics — scan all markers against full text,
    # ordered so unique markers (e.g. ş for Turkish) take priority over
    # shared ones (e.g. ü which appears in both German and Turkish).
    t = text.lower()
    for marker, lang in _LATIN_LANG_MARKERS:
        if marker in t:
            return lang
    return "english"


def _tutorial_search_suffix(title: str, artist: str) -> str:
    """Return search suffix terms in the song's detected language, with English fallback."""
    lang = _detect_language(f"{title} {artist}")
    native_terms = _TUTORIAL_SEARCH_TERMS.get(lang, "")
    english_terms = "guitar tutorial strumming pattern"
    if native_terms:
        return f"{native_terms} {english_terms}"
    return english_terms


class LlmService:
    def __init__(self, settings: Settings) -> None:
        self._model_id = settings.llm_models.name_parsing
        self._lyrics_merge_model_id = (
            settings.llm_models.lyrics_merging or settings.llm_models.name_parsing
        )
        self._strum_model_id = (
            settings.llm_models.strum_patterns or settings.llm_models.name_parsing
        )

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

    # ---- Lyrics source merging ----

    def _align_lyrics_segments_sync(
        self,
        quick_segments: list[dict],
        regular_segments: list[dict],
    ) -> list[LyricsSegmentMapping]:
        """Map quick lyric segments to regular lyric timing segments via Bedrock."""
        quick_block = "\n".join(
            (
                f"Q{segment['index']}: text={segment['text']!r}; "
                f"words={segment.get('words', [])}; count={segment.get('word_count', 0)}"
            )
            for segment in quick_segments
        )
        regular_block = "\n".join(
            (
                f"R{segment['index']}: {segment['start']:.3f}-{segment['end']:.3f}; "
                f"text={segment['text']!r}; words={segment.get('words', [])}; "
                f"count={segment.get('word_count', 0)}"
            )
            for segment in regular_segments
        )

        prompt = (
            "You are merging two lyric sources for the SAME song.\n\n"
            "Source A (quick lyrics) has the CORRECT wording and segmentation.\n"
            "Source B (regular lyrics) has the BETTER timing, but wording and segmentation may be wrong, collapsed, duplicated, or messy.\n\n"
            "Your task: for EVERY quick segment, map it to the best contiguous inclusive range of regular segment indices that carries the timing for that quick segment.\n\n"
            "Rules:\n"
            "- Return exactly one mapping object per quick segment.\n"
            "- quick_index must match the quick segment index exactly.\n"
            "- Preserve order: mappings must be non-decreasing in regular_start_index and regular_end_index.\n"
            "- If one regular segment covers multiple quick segments, it is OK for adjacent quick segments to share the same regular_start_index/regular_end_index range.\n"
            "- Prefer timing structure over exact wording when the regular text is noisy.\n"
            f"- regular_start_index and regular_end_index must be between 0 and {len(regular_segments) - 1} inclusive. Do NOT use any index outside this range.\n"
            "- confidence is a float from 0.0 to 1.0.\n\n"
            f"There are {len(quick_segments)} quick segments (indices 0-{len(quick_segments) - 1}) and "
            f"{len(regular_segments)} regular segments (indices 0-{len(regular_segments) - 1}).\n\n"
            f"{schema_instruction(LyricsSegmentMapping, is_list=True)}\n\n"
            f"Quick segments:\n{quick_block}\n\n"
            f"Regular segments:\n{regular_block}"
        )

        messages: list[dict] = [
            {"role": "user", "content": [{"text": prompt}]},
        ]

        expected = len(quick_segments)
        max_regular_index = max(len(regular_segments) - 1, 0)

        for attempt in range(MAX_LLM_RETRIES):
            raw_text = self._client.converse(
                modelId=self._lyrics_merge_model_id,
                messages=messages,
                inferenceConfig={"maxTokens": 50000},
            )["output"]["message"]["content"][0]["text"]
            cleaned_text = raw_text.strip()
            cleaned_text = re.sub(r"^```(?:json)?\s*", "", cleaned_text)
            cleaned_text = re.sub(r"\s*```$", "", cleaned_text)

            try:
                json_match = re.search(r"\[.*\]", cleaned_text, re.DOTALL)
                if not json_match:
                    raise ValueError(f"No JSON array found in LLM response: {raw_text}")

                raw_list = json.loads(json_match.group())
                parsed = [
                    LyricsSegmentMapping.model_validate(item) for item in raw_list
                ]

                if len(parsed) != expected:
                    raise ValueError(f"Expected {expected} mappings, got {len(parsed)}")

                for idx, mapping in enumerate(parsed):
                    if mapping.quick_index != idx:
                        raise ValueError(
                            f"Expected quick_index {idx}, got {mapping.quick_index}"
                        )
                    if mapping.regular_start_index < 0 or mapping.regular_end_index < 0:
                        raise ValueError("Regular segment indices must be non-negative")
                    if mapping.regular_start_index > mapping.regular_end_index:
                        raise ValueError(
                            "regular_start_index cannot be greater than regular_end_index"
                        )
                    if mapping.regular_end_index > max_regular_index:
                        raise ValueError(
                            f"Regular segment index out of range: {mapping.regular_end_index} > {max_regular_index}"
                        )
                    if idx > 0:
                        prev = parsed[idx - 1]
                        if mapping.regular_start_index < prev.regular_start_index:
                            raise ValueError(
                                "Mappings are not monotonic in regular_start_index"
                            )
                        if mapping.regular_end_index < prev.regular_end_index:
                            raise ValueError(
                                "Mappings are not monotonic in regular_end_index"
                            )

                return parsed
            except Exception as e:
                logger.warning(
                    "LLM lyrics segment alignment attempt %d/%d failed: %s",
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
                                        f"Your response could not be parsed or validated: {e}\n\n"
                                        f"Return ONLY a JSON array of exactly {expected} mapping objects. "
                                        "Each object must contain quick_index, regular_start_index, "
                                        "regular_end_index, and confidence. quick_index must match the "
                                        "quick segment index in order, and regular indices must stay monotonic."
                                    )
                                }
                            ],
                        },
                    )
                else:
                    raise

        raise RuntimeError("Unreachable")

    async def align_lyrics_segments(
        self,
        quick_segments: list[dict],
        regular_segments: list[dict],
    ) -> list[LyricsSegmentMapping]:
        """Map quick lyric segments to regular lyric timing segments via Bedrock."""
        return await asyncio.to_thread(
            self._align_lyrics_segments_sync,
            quick_segments,
            regular_segments,
        )

    def align_lyrics_segments_sync(
        self,
        quick_segments: list[dict],
        regular_segments: list[dict],
    ) -> list[LyricsSegmentMapping]:
        """Synchronous lyrics segment mapper for scripts and batch jobs."""
        return self._align_lyrics_segments_sync(quick_segments, regular_segments)

    # JSON Schema for the strum pattern tool (used by Bedrock toolConfig)
    _STRUM_TOOL_SCHEMA: dict = {
        "tools": [
            {
                "toolSpec": {
                    "name": "provide_strum_patterns",
                    "description": "Provide the strumming pattern for a song",
                    "inputSchema": {
                        "json": {
                            "type": "object",
                            "properties": {
                                "sections": {
                                    "type": "array",
                                    "description": "Strumming patterns per song section",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "section": {
                                                "type": "string",
                                                "description": "Section name, e.g. 'Verse', 'Chorus', 'Bridge', or 'Song' if uniform",
                                            },
                                            "pattern": {
                                                "type": "array",
                                                "description": "Strum directions for one measure. Use only 'down' and 'up'.",
                                                "items": {
                                                    "type": "string",
                                                    "enum": ["down", "up"],
                                                },
                                            },
                                        },
                                        "required": ["section", "pattern"],
                                    },
                                },
                                "bpm": {
                                    "type": "integer",
                                    "description": "Approximate BPM of the song",
                                },
                                "notes": {
                                    "type": "string",
                                    "description": "Playing instructions and tips: time signature, rhythm feel, accent patterns, tempo changes, chord voicing tips, and any other useful info for playing along",
                                },
                            },
                            "required": ["sections"],
                        },
                    },
                },
            },
        ],
        "toolChoice": {"tool": {"name": "provide_strum_patterns"}},
    }

    @staticmethod
    def _search_strum_pattern(
        artist: str, title: str, tavily_api_key: str,
    ) -> dict | None:
        """Search the web for strumming pattern info via Tavily.

        Returns dict with 'content' (text for LLM) and 'tutorial_links' (YouTube/tutorial URLs).
        """
        import httpx

        query = f'{title} {artist} {_tutorial_search_suffix(title, artist)}'
        try:
            resp = httpx.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": tavily_api_key,
                    "query": query,
                    "search_depth": "advanced",
                    "max_results": 5,
                    "include_answer": "advanced",
                },
                timeout=15.0,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning("Tavily search failed for %r by %r: %s", title, artist, e)
            return None

        results = data.get("results", [])
        answer = data.get("answer", "")

        if not results and not answer:
            return None

        # Combine Tavily answer + search result content for the LLM
        snippets: list[str] = []
        if answer:
            snippets.append(f"Tavily AI Answer:\n{answer}")

        # Extract tutorial links (YouTube, lesson sites)
        tutorial_links: list[dict[str, str]] = []
        for r in results[:5]:
            source = r.get("url", "")
            content = r.get("content", "")
            title_text = r.get("title", "")
            if content:
                snippets.append(f"Source: {source}\n{content}")
            if source and any(
                domain in source for domain in
                ["youtube.com", "youtu.be", "justinguitar.com", "guitartricks.com"]
            ):
                tutorial_links.append({
                    "url": source,
                    "title": title_text or content[:80] if content else source,
                })

        combined = "\n\n---\n\n".join(snippets)
        logger.info(
            "Tavily: found %d results, %d tutorials for %r by %r (%d chars)",
            len(results), len(tutorial_links), title, artist, len(combined),
        )
        return {"content": combined, "tutorial_links": tutorial_links}

    def _lookup_strum_patterns_sync(
        self, artist: str, title: str,
        time_signature: tuple[int, int] | None = None,
        tavily_api_key: str | None = None,
    ) -> StrumPatternResult | None:
        """Look up strumming pattern via web search + LLM parsing.

        1. Search the web for strumming pattern info (Tavily)
        2. Feed search results to the LLM for structured extraction
        Falls back to pure LLM knowledge if search fails.
        """
        time_sig_line = ""
        if time_signature:
            time_sig_line = f"- The song is in {time_signature[0]}/{time_signature[1]} time.\n"

        # Step 1: Search the web for strumming pattern info
        search_context = ""
        self._last_tutorial_links: list[dict[str, str]] = []
        if tavily_api_key:
            search_result = self._search_strum_pattern(artist, title, tavily_api_key)
            if search_result:
                self._last_tutorial_links = search_result.get("tutorial_links", [])
                web_content = search_result["content"]
                search_context = (
                    "I found the following information about this song's strumming pattern "
                    "from guitar tutorial websites. Use this to extract the pattern:\n\n"
                    f"{web_content}\n\n"
                    "Based on the above search results, "
                )

        # Step 2: Build the prompt
        if search_context:
            prompt = (
                f"{search_context}"
                f'extract the strumming pattern for "{title}" by {artist}.\n\n'
                "Rules:\n"
                "- Return the pattern for ONE measure (one bar) in the song's time signature.\n"
                "- Use only 'down' and 'up' for each strum stroke.\n"
                f"{time_sig_line}"
                "- IMPORTANT: Extract ALL distinct patterns from the search results.\n"
                "  If there is a basic/simple pattern AND an expanded/full pattern, list BOTH as separate sections.\n"
                "  If different parts of the song use different patterns "
                "(e.g. verse vs chorus, or different chord groups), list EACH as a separate section.\n"
                "  Use descriptive section names like 'Basic Pattern', 'Expanded Pattern', "
                "'Verse', 'Chorus', 'G & D chords', etc.\n"
                "- Include the approximate BPM from the search results.\n"
                "- In the 'notes' field, include useful playing instructions: time signature, "
                "rhythm feel (e.g. waltz, shuffle, swing), accent patterns, "
                "tempo tips, chord voicing suggestions, and any other helpful info from the search results.\n"
            )
        else:
            prompt = (
                f'What is the standard strumming pattern for "{title}" by {artist}?\n\n'
                "Return the beginner/standard pattern as commonly taught on guitar tutorial sites.\n\n"
                "Rules:\n"
                "- Return the pattern for ONE measure (one bar) in the song's time signature.\n"
                "- Use only 'down' and 'up' for each strum stroke.\n"
                f"{time_sig_line}"
                "- If different parts use different patterns (verse vs chorus, or different chord groups), "
                "list EACH as a separate section with descriptive names.\n"
                "- If the whole song uses one pattern, use section name 'Song'.\n"
                "- Include the approximate BPM.\n"
                "- IMPORTANT: If you're not sure about this specific song, return an empty sections array.\n"
                "  Do NOT guess — only return patterns you're confident about.\n"
            )

        messages: list[dict] = [
            {"role": "user", "content": [{"text": prompt}]},
        ]

        for attempt in range(MAX_LLM_RETRIES):
            try:
                response = self._client.converse(
                    modelId=self._strum_model_id,
                    messages=messages,
                    toolConfig=self._STRUM_TOOL_SCHEMA,
                )

                # Extract tool_use block from response
                for block in response["output"]["message"]["content"]:
                    if block.get("toolUse"):
                        tool_input = block["toolUse"]["input"]
                        result = StrumPatternResult.model_validate(tool_input)
                        # Attach tutorial links from Tavily search
                        result.tutorial_links = [
                            TutorialLink(**link) for link in self._last_tutorial_links
                        ]
                        if result.sections:
                            logger.info(
                                "LLM strum lookup: got %d sections for %r by %r (web_search=%s)",
                                len(result.sections), title, artist,
                                bool(search_context),
                            )
                            return result

                        logger.info(
                            "LLM strum lookup: empty sections for %r by %r",
                            title, artist,
                        )
                        return None

                logger.warning(
                    "LLM strum lookup: no tool_use in response (attempt %d)", attempt,
                )

            except Exception as e:
                logger.warning(
                    "LLM strum lookup failed (attempt %d): %s", attempt, e,
                )

        return None

    async def lookup_strum_patterns(
        self, artist: str, title: str,
        time_signature: tuple[int, int] | None = None,
        tavily_api_key: str | None = None,
    ) -> StrumPatternResult | None:
        """Async wrapper for strum pattern lookup."""
        return await asyncio.to_thread(
            self._lookup_strum_patterns_sync, artist, title, time_signature,
            tavily_api_key,
        )
