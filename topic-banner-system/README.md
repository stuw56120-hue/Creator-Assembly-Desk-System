# Topic Change Banner System

A deterministic subsystem for a GPT-assisted video editing engine. Detects conversational topic shifts in video transcripts and produces structured JSON schema events that drive motion graphic banner overlays.

## Requirements

- Node.js 20+
- pnpm

## Setup

```bash
pnpm install
```

## Run Tests

```bash
pnpm test
```

## Build

```bash
pnpm build
```

## Usage

```bash
node dist/index.js --manifest path/to/manifest.json --out path/to/output.json
```

### Manifest format

```json
{
  "job_id": "my-job-001",
  "transcript": [
    { "start_ms": 0, "end_ms": 5000, "text": "Hello world", "speaker_id": "A" }
  ],
  "detection_profile": "podcast",
  "face_zones": [{ "x": 0.5, "y": 0.1, "width": 0.4, "height": 0.4 }],
  "render_context": { "resolution": "1080p", "scale_factor": 1.0 },
  "threshold_overrides": { "major_similarity_threshold": 0.50 }
}
```

Detection profiles: `podcast`, `sports`, `documentary`, `interview`.

## Architecture

```
Transcript
    │
    ├── silence.ts      → silence gap candidates
    ├── speaker.ts      → speaker transition candidates
    ├── semantic.ts     → cosine similarity scores (OpenAI embeddings)
    └── gpt_editorial.ts → GPT-4o-mini editorial analysis
           │
           └── pipeline.ts (40/20/20/20 weighted merge)
                    │
                    └── BannerEvent (Zod validated)
                             │
                             ├── position.ts (face zone collision)
                             ├── timing.ts   (overlap guard)
                             └── render_context.ts (scale)
```

## Determinism

- No random IDs in schema output
- No `Date.now()` in BannerEvents (timecode from transcript)
- All thresholds live in `config/detection_profiles.json`
- All external API calls (OpenAI, GPT) are injectable for testing
