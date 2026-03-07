#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "google-genai>=1.0.0",
#   "pillow>=10.0.0",
# ]
# ///
"""Generate (or edit) an image via Gemini 3 Pro Image.

This is used for *project art assets* (logo/background/empty states).

Examples:
  uv run scripts/generate_image.py -p "A fiery guitar pick logo..." -f frontend/public/logo.png -r 1K
  uv run scripts/generate_image.py -p "Dark smoky stage..." -f frontend/public/hero-bg.jpg -r 2K
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def _api_key(provided: str | None) -> str | None:
    if provided:
        return provided
    return os.environ.get("GEMINI_API_KEY")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate images with Gemini 3 Pro Image"
    )
    parser.add_argument("--prompt", "-p", required=True, help="Prompt")
    parser.add_argument("--filename", "-f", required=True, help="Output file path")
    parser.add_argument(
        "--input-image",
        "-i",
        action="append",
        dest="inputs",
        metavar="IMAGE",
        help="Optional input image(s) for editing/composition. Repeat up to 14x.",
    )
    parser.add_argument("--resolution", "-r", choices=["1K", "2K", "4K"], default="1K")
    parser.add_argument("--api-key", "-k", help="Overrides GEMINI_API_KEY")
    args = parser.parse_args()

    key = _api_key(args.api_key)
    if not key:
        print("Missing Gemini API key.", file=sys.stderr)
        print("Set GEMINI_API_KEY in your environment (recommended).", file=sys.stderr)
        print(
            "Or pass --api-key (not recommended; leaks into shell history).",
            file=sys.stderr,
        )
        return 1

    from google import genai
    from google.genai import types
    from PIL import Image as PILImage

    out_path = Path(args.filename)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    input_images: list[PILImage.Image] = []
    if args.inputs:
        if len(args.inputs) > 14:
            print(
                f"Too many input images: {len(args.inputs)} (max 14)", file=sys.stderr
            )
            return 1
        for p in args.inputs:
            input_images.append(PILImage.open(p))

    if input_images:
        contents = [*input_images, args.prompt]
    else:
        contents = args.prompt

    client = genai.Client(api_key=key)
    response = client.models.generate_content(
        model="gemini-3-pro-image-preview",
        contents=contents,
        config=types.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"],
            image_config=types.ImageConfig(image_size=args.resolution),
        ),
    )

    image_bytes: bytes | None = None
    for part in getattr(response, "parts", []) or []:
        if getattr(part, "inline_data", None) is not None:
            image_bytes = part.inline_data.data
            break

    if not image_bytes:
        print("No image returned by the model.", file=sys.stderr)
        return 1

    from io import BytesIO

    img = PILImage.open(BytesIO(image_bytes))

    # Save as the requested extension.
    suffix = out_path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        if img.mode == "RGBA":
            bg = PILImage.new("RGB", img.size, (0, 0, 0))
            bg.paste(img, mask=img.split()[3])
            img = bg
        else:
            img = img.convert("RGB")
        img.save(out_path, format="JPEG", quality=92, optimize=True, progressive=True)
    else:
        if img.mode not in {"RGB", "RGBA"}:
            img = img.convert("RGBA")
        img.save(out_path, format="PNG")

    print(f"Saved: {out_path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
