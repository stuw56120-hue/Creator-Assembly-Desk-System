#!/usr/bin/env python3
"""
C.A.D.S. transcription worker.

Transcribes a WAV with faster-whisper (local, no API) and writes a clean
transcript. Writes WebVTT when the output path ends in .vtt, otherwise a plain
text transcript with [HH:MM:SS] timestamps.

Usage:
    python transcribe_worker.py --input <audio.wav> --output <transcript.txt> \
        --model base --language en

Stage/percent progress is emitted to stderr as "PROGRESS <stage> <percent>"
lines; a JSON summary is printed to stdout on success. Errors go to stderr with
exit 1.
"""

import argparse
import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel


def _progress(stage: str, percent: int) -> None:
    print(f"PROGRESS {stage} {percent}", file=sys.stderr, flush=True)


def _fmt_ts(seconds: float) -> str:
    s = max(0.0, seconds)
    h = int(s // 3600)
    m = int((s % 3600) // 60)
    sec = s % 60
    return f"{h:02d}:{m:02d}:{sec:06.3f}"


def transcribe(input_path: Path, output_path: Path, model_size: str, language: str) -> dict:
    if not input_path.exists():
        raise FileNotFoundError(f"audio not found: {input_path}")

    _progress("Loading Whisper model", 5)
    # CPU + int8 keeps it dependency-light and runs without a GPU.
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    lang = None if not language or language.lower() == "auto" else language
    _progress("Transcribing", 10)
    segments, info = model.transcribe(str(input_path), language=lang, vad_filter=True)

    total = info.duration or 0.0
    is_vtt = output_path.suffix.lower() == ".vtt"
    lines: list[str] = ["WEBVTT", ""] if is_vtt else []
    count = 0

    output_path.parent.mkdir(parents=True, exist_ok=True)
    for seg in segments:
        text = seg.text.strip()
        if is_vtt:
            lines.append(f"{_fmt_ts(seg.start)} --> {_fmt_ts(seg.end)}")
            lines.append(text)
            lines.append("")
        else:
            lines.append(f"[{_fmt_ts(seg.start)}] {text}")
        count += 1
        if total > 0:
            pct = min(99, 10 + int((seg.end / total) * 89))
            _progress("Transcribing", pct)

    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    _progress("Done", 100)

    return {
        "transcript_path": str(output_path),
        "language": info.language,
        "duration": round(total, 2),
        "segment_count": count,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default="en")
    args = parser.parse_args()

    try:
        result = transcribe(Path(args.input), Path(args.output), args.model, args.language)
        print(json.dumps(result), flush=True)
    except Exception as e:  # noqa: BLE001 — surface any failure cleanly to the IPC layer
        print(f"ERROR: {e}", file=sys.stderr, flush=True)
        sys.exit(1)
