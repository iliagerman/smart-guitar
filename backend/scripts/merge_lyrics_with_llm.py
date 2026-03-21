from __future__ import annotations

# pyright: reportMissingImports=false, reportMissingModuleSource=false

import argparse
import json
import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def main() -> None:
    from guitar_player.config import get_settings
    from guitar_player.services.llm_service import LlmService
    from guitar_player.services.lyrics_correction import merge_lyrics_with_llm

    parser = argparse.ArgumentParser(
        description="Create lyrics_corrected.json by combining quick wording with regular timing."
    )
    parser.add_argument("--quick", required=True, help="Path to lyrics_quick.json")
    parser.add_argument("--regular", required=True, help="Path to lyrics.json")
    parser.add_argument(
        "--output",
        help="Output path. Defaults to a sibling lyrics_corrected.json next to the quick file.",
    )
    parser.add_argument(
        "--backup",
        action="store_true",
        help="Create a .bak copy of the output file before overwriting it.",
    )
    args = parser.parse_args()

    quick_path = Path(args.quick).expanduser().resolve()
    regular_path = Path(args.regular).expanduser().resolve()
    output_path = (
        Path(args.output).expanduser().resolve()
        if args.output
        else quick_path.with_name("lyrics_corrected.json")
    )

    quick_data = json.loads(quick_path.read_text(encoding="utf-8"))
    regular_data = json.loads(regular_path.read_text(encoding="utf-8"))

    settings = get_settings()
    llm = LlmService(settings)
    merged, diagnostics = merge_lyrics_with_llm(quick_data, regular_data, llm)

    if args.backup and output_path.exists():
        backup_path = output_path.with_suffix(output_path.suffix + ".bak")
        shutil.copy2(output_path, backup_path)
        print(f"Created backup: {backup_path}")

    output_path.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    print(
        "Merged lyrics with "
        f"{diagnostics.aligned_words}/{diagnostics.total_words} aligned words "
        f"across {diagnostics.mapping_groups} mapping groups"
    )
    print(f"Wrote corrected lyrics to: {output_path}")


if __name__ == "__main__":
    main()
