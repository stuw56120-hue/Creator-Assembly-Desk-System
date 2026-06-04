#!/usr/bin/env python3
"""
C.A.D.S. image processing worker.

Produces three variants from one uploaded image, stored together in the Asset
Library, and prints a JSON result to stdout:

    original  - the image, reformatted + renamed (PNG if it has alpha, else JPEG)
    nobg      - background removed (transparent PNG) via rembg / u2net, fully local
    bg_blur   - sharp subject composited over a Gaussian-blurred copy (bokeh look)

Usage:
    python process_image_worker.py --input <path> --output-dir <dir> --filename <name>

Stage progress is emitted to stderr as "PROGRESS <stage> <percent>" lines so the
IPC handler can surface a progress bar; the final JSON goes to stdout. On any
failure the worker prints "ERROR: ..." to stderr and exits 1.
"""

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageFilter
from rembg import remove

GAUSSIAN_BLUR_RADIUS = 25


def _progress(stage: str, percent: int) -> None:
    print(f"PROGRESS {stage} {percent}", file=sys.stderr, flush=True)


def process(input_path: Path, output_dir: Path, filename: str) -> dict:
    if not input_path.exists():
        raise FileNotFoundError(f"input image not found: {input_path}")

    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. Load original; detect meaningful transparency.
    _progress("Loading image", 5)
    img = Image.open(input_path).convert("RGBA")
    has_alpha = img.mode == "RGBA" and img.split()[3].getextrema()[0] < 255

    # Save the original (renamed): PNG when transparent, otherwise high-quality JPEG.
    ext = ".png" if has_alpha else ".jpg"
    original_path = output_dir / f"{filename}{ext}"
    if has_alpha:
        img.save(original_path, "PNG")
    else:
        img.convert("RGB").save(original_path, "JPEG", quality=95)

    # 2. Background removal (rembg high-level API — runs locally on u2net).
    _progress("Removing background", 35)
    nobg_path = output_dir / f"{filename}-nobg.png"
    with open(input_path, "rb") as f:
        nobg_result = remove(f.read())
    nobg_path.write_bytes(nobg_result)
    nobg_img = Image.open(nobg_path).convert("RGBA")

    # 3. Bokeh blur composite: sharp subject over a blurred copy of the original.
    _progress("Compositing bokeh", 80)
    bgblur_path = output_dir / f"{filename}-bg-blur.jpg"
    base = img.convert("RGB")
    blurred = base.filter(ImageFilter.GaussianBlur(radius=GAUSSIAN_BLUR_RADIUS))
    composite = blurred.copy()
    composite.paste(nobg_img, (0, 0), nobg_img.split()[3])
    composite.save(bgblur_path, "JPEG", quality=92)

    _progress("Done", 100)
    return {
        "original": str(original_path),
        "nobg": str(nobg_path),
        "bg_blur": str(bgblur_path),
        "width": img.width,
        "height": img.height,
        "has_alpha": has_alpha,
    }


def prefetch_model() -> dict:
    """Force the one-time u2net model download without processing an image."""
    _progress("Preparing background-removal model", 10)
    from rembg import new_session

    new_session("u2net")  # triggers the ~170MB download to ~/.u2net on first use
    _progress("Done", 100)
    return {"prefetched": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--output-dir")
    parser.add_argument("--filename")
    parser.add_argument("--prefetch-model", action="store_true")
    args = parser.parse_args()

    try:
        if args.prefetch_model:
            result = prefetch_model()
        else:
            if not (args.input and args.output_dir and args.filename):
                raise ValueError("--input, --output-dir and --filename are required")
            result = process(Path(args.input), Path(args.output_dir), args.filename)
        print(json.dumps(result), flush=True)
    except Exception as e:  # noqa: BLE001 — surface any failure cleanly to the IPC layer
        print(f"ERROR: {e}", file=sys.stderr, flush=True)
        sys.exit(1)
