# CADS — Shorts Schema v2
## Multi-Segment Aggressive Short-Form Specification
### June 2026

---

## Overview

The current shorts schema treats a short as a single clip — one start time, one end time, with overlays applied on top. This produces passive, low-energy output unsuitable for TikTok and YouTube Shorts.

Shorts Schema v2 replaces the clip model with a sequence model. A short is a directed sequence of independently timed fragments assembled from different points in the source recording, with aggressive cuts between them, heavy use of motion graphics, and captions optimised for vertical viewing.

The Edit Director produces the new schema. CADS renders it. No manual timeline editing required.

---

## The Core Structural Change

### Current schema (v1 — replace this)

```json
{
  "short_id": "short_001",
  "title": "Spurs Survived: 101 Minutes of Stress",
  "start_time": "00:00:31.160",
  "end_time": "00:02:20.769",
  "motion_overlays": [],
  "player_image_overlays": [],
  "topic_banner": {}
}
```

A single clip. No internal structure. No cuts. No pacing control.

### New schema (v2 — build this)

```json
{
  "short_id": "short_001",
  "title": "Spurs Survived: 101 Minutes of Stress",
  "target_duration_seconds": 45,
  "caption_style": "shorts_bold",
  "hook": {
    "text": "101 minutes of stress and Spurs still survived.",
    "overlay": {
      "motion_graphic_id": "topic_banner",
      "params": { "title": "SPURS SURVIVE", "accent_colour": "#00c2ff" },
      "duration_seconds": 3.0
    }
  },
  "segments": [
    {
      "segment_id": "seg_001",
      "start_time": "00:00:33.440",
      "end_time": "00:00:42.280",
      "speaker_focus": "stuart",
      "energy": "high",
      "transition_in": "cut",
      "transition_out": "punch_zoom",
      "overlays": [
        {
          "motion_graphic_id": "quote_card",
          "params": { "text": "GAME OVER, MAN" },
          "appear_at_seconds": 2.0,
          "duration_seconds": 3.0
        }
      ],
      "caption_emphasis": ["game over", "right side of that line"]
    },
    {
      "segment_id": "seg_002",
      "start_time": "00:02:05.570",
      "end_time": "00:02:20.769",
      "speaker_focus": "stuart",
      "energy": "high",
      "transition_in": "smash_cut",
      "transition_out": "cut",
      "overlays": [
        {
          "motion_graphic_id": "quote_card",
          "params": { "text": "101 MINUTES OF STRESS" },
          "appear_at_seconds": 1.0,
          "duration_seconds": 3.0
        }
      ],
      "caption_emphasis": ["101 minutes", "still convinced", "two goals"]
    }
  ],
  "player_image_overlays": [],
  "cta": {
    "text": "Follow for more Spurs coverage",
    "motion_graphic_id": "subscribe_flash",
    "params": { "platform": "TikTok", "accent_colour": "#00c2ff" }
  }
}
```

---

## Schema Definition

### Top-level short object

```typescript
interface Short {
  short_id:                string;
  title:                   string;
  target_duration_seconds: number;          // 45 maximum
  caption_style:           ShortCaptionStyle;
  hook:                    ShortHook;
  segments:                ShortSegment[];  // minimum 4, maximum 10
  player_image_overlays:   PlayerImageOverlay[];
  cta:                     ShortCTA;
  notes?:                  string[];
}
```

### ShortCaptionStyle

```typescript
type ShortCaptionStyle =
  | "shorts_bold"        // large, bold, centred, word-by-word highlight — default
  | "shorts_minimal"     // smaller, lower third, less intrusive
  | "shorts_kinetic";    // animated word-by-word, highest energy
```

All styles must:
- Respect 1080px portrait frame width with 80px safe area padding on each side (max 920px)
- Use minimum font size 52px for readability on mobile
- Never exceed 2 lines simultaneously
- Word-wrap at the safe area boundary — never overflow the frame

### ShortHook

```typescript
interface ShortHook {
  text:     string;           // spoken or displayed hook line — not TTS, visual only
  overlay:  ShortOverlay;     // the opening motion graphic
}
```

The hook overlay appears in the first 3 seconds before the first segment begins. It is the visual anchor that establishes the short's subject.

### ShortSegment

```typescript
interface ShortSegment {
  segment_id:          string;
  start_time:          string;          // HH:MM:SS.mmm — source recording timecode
  end_time:            string;          // HH:MM:SS.mmm — source recording timecode
  speaker_focus?:      string;          // speaker name — for framing hint
  energy:              "low" | "medium" | "high" | "peak";
  transition_in:       SegmentTransition;
  transition_out:      SegmentTransition;
  overlays:            ShortOverlay[];
  caption_emphasis:    string[];        // words/phrases to highlight in captions
}
```

### SegmentTransition

```typescript
type SegmentTransition =
  | "cut"           // immediate — use for most transitions
  | "smash_cut"     // very fast cut with a single frame flash
  | "punch_zoom"    // fast zoom punch on the cut point
  | "whip_pan"      // directional whip
  | "flash_white"   // single frame white flash
  | "none";         // first segment in only — no transition in
```

### ShortOverlay

```typescript
interface ShortOverlay {
  motion_graphic_id:  string;       // must exist in template-registry.json
  params:             Record<string, unknown>;  // validated against registry schema
  appear_at_seconds:  number;       // seconds after segment start_time (0 = immediate)
  duration_seconds:   number;       // must not exceed segment duration - appear_at_seconds
}
```

### ShortCTA

```typescript
interface ShortCTA {
  text:              string;
  motion_graphic_id: string;        // typically "subscribe_flash"
  params:            Record<string, unknown>;
}
```

---

## Timing Rules

### Maximum duration
Total assembled duration = sum of all segment durations + hook duration. Must not exceed 45 seconds. The parser must reject shorts over 45 seconds at validation time with a plain-English error.

### Minimum segment count
A short must have at least 4 segments. A 2-segment short is a clip, not a short. The parser should warn (not reject) on fewer than 4 segments.

### Segment duration guidelines (for Edit Director)
- Hook: 2-3 seconds
- Opening segment: 4-8 seconds — establish the subject
- Middle segments: 3-6 seconds each — fast, punchy
- Penultimate segment: 4-6 seconds — the payoff moment
- CTA: 2-3 seconds — visual hold only, no source audio

### Overlay timing constraint
An overlay's `appear_at_seconds` + `duration_seconds` must not exceed the segment's own duration. The parser rejects overlaps with a plain-English error identifying the specific segment and overlay.

---

## Caption Specification

### shorts_bold (default)

```
Font:         Inter Bold or system-ui bold fallback
Size:         64px at 1080px width (scales proportionally)
Colour:       White (#FFFFFF) with 2px black text-shadow
Position:     Horizontally centred, vertically 65% down the frame
Max width:    920px (80px padding each side)
Line wrap:    At 920px — never overflow
Max lines:    2 simultaneously
Highlight:    Words in caption_emphasis array render with yellow (#FFD700) fill
Animation:    Word-by-word — each word appears as it is spoken
```

### shorts_minimal

```
Font:         Inter Regular
Size:         48px
Colour:       White with semi-transparent black background pill
Position:     Lower third — 85% down the frame
Max width:    920px
Max lines:    2
Highlight:    Bold weight on caption_emphasis words
Animation:    Phrase-by-phrase (3-5 words at a time)
```

### shorts_kinetic

```
Font:         Inter Black
Size:         72px
Colour:       White, with caption_emphasis words in accent colour (#00c2ff)
Position:     Centre frame
Max width:    900px
Max lines:    1 (single word or short phrase at a time)
Animation:    Single word, scales in from 80% to 100% on appear
```

---

## FFmpeg Render Pipeline Changes

### Current shorts render
```
[source video] → trim(start, end) → scale(1080x1920) → overlay(MGs) → encode
```

Single trim. No assembly.

### New shorts render

```
For each segment:
  [source video] → trim(segment.start, segment.end) → scale(1080x1920) → [seg_N.mp4]

[hook overlay WebM] + [seg_0.mp4] + [seg_1.mp4] + ... + [seg_N.mp4]
  → concat with transition effects between segments
  → overlay motion graphics per segment (timed relative to segment start)
  → burn-in captions (shorts_bold style, word-by-word, portrait-safe)
  → CTA overlay on final segment
  → encode → short_001.mp4
```

### Transition implementation in FFmpeg

**cut:** concat demuxer — no filter needed, frame-accurate
**smash_cut:** 1-frame white overlay at the cut point via overlay filter
**punch_zoom:** zoompan filter on the outgoing clip's last 0.3 seconds
**whip_pan:** the existing whip_pan Hyperframes block (verify 9:16 compatibility first)
**flash_white:** colorkey/overlay with a 2-frame white frame injected at cut

### Caption burn-in for shorts

The existing ASS caption system used for longform is not suitable for shorts. Shorts need a new caption path:

- Generate a word-level timing map from the source transcript (timestamps already present in the VTT)
- For each segment, extract the word-level timings that fall within segment.start → segment.end
- Re-offset word timings to be relative to assembled timeline position (segment's position in the concat, not source position)
- Generate a new ASS file with the shorts_bold style, 920px wrap width, word-by-word karaoke timing
- Apply caption_emphasis highlights via ASS \fscx \fscy or \c colour override on those words

---

## Edit Director Instructions (additions to news-director-v2.md prompt)

Add the following section to the Edit Director (podcast) prompt. The News Director v2 prompt already handles short-form videos — these instructions are for the podcast Edit Director producing shorts from longform recordings.

```
## SHORTS SCHEMA V2 — MANDATORY FOR ALL SHORTS

Every short must use segments[], not start_time/end_time. This is non-negotiable.

SEGMENT SELECTION RULES:
- Minimum 4 segments per short, maximum 10
- Total assembled duration must not exceed 45 seconds
- Select only the ultra-relevant moments — cut everything else
- One idea per segment — never carry a thought across segments
- Each segment should work standalone — the viewer must understand it without context
- Prefer moments with a strong speaker reaction, a punchy line, or a clear emotional beat
- Never include setup without payoff in the same short — if you need context, use the hook overlay

TRANSITION RULES:
- Default transition_out: punch_zoom for high energy segments, cut for medium
- smash_cut: use once per short maximum, on the highest energy moment
- flash_white: use once per short maximum, on the reveal or payoff moment
- Never use the same transition twice in a row

OVERLAY RULES:
- Every segment should have at least one overlay if the content warrants it
- quote_card: use for the strongest spoken line — verbatim, under 6 words ideally
- topic_banner: opening hook only
- subscribe_flash: CTA only — never mid-short
- meme_pop_in: use sparingly — once per short maximum

CAPTION EMPHASIS RULES:
- caption_emphasis array: 2-4 words or short phrases per segment maximum
- Choose words that carry the most meaning or emotion
- Never emphasise filler words or conjunctions

ENERGY LEVELS:
- "high" and "peak" segments: punch_zoom or smash_cut transitions, strong overlays
- "medium" segments: cut transitions, overlays optional
- Never open with a "low" energy segment
- Never end with a "low" or "medium" energy segment before the CTA

DURATION CHECK — MANDATORY:
Before outputting, sum all segment durations. If total exceeds 45 seconds, remove the weakest segment and recheck. Never output a short over 45 seconds.
```

---

## Validation Changes (editListParser.ts)

Add these validation rules for the new shorts schema:

```typescript
// Reject shorts using old start_time/end_time schema
if (short.start_time && !short.segments) {
  errors.push(`${short.short_id}: uses deprecated clip schema. Must use segments[]. Re-generate with Edit Director v2.`);
}

// Reject shorts over 45 seconds
const totalDuration = short.segments.reduce((acc, seg) => {
  const dur = parseTimestamp(seg.end_time) - parseTimestamp(seg.start_time);
  return acc + dur;
}, 0) + HOOK_DURATION;

if (totalDuration > 45) {
  errors.push(`${short.short_id}: assembled duration ${totalDuration.toFixed(1)}s exceeds 45s maximum.`);
}

// Warn on fewer than 4 segments
if (short.segments.length < 4) {
  warnings.push(`${short.short_id}: only ${short.segments.length} segments — minimum 4 recommended for short-form pacing.`);
}

// Reject overlay timing violations
short.segments.forEach(seg => {
  const segDur = parseTimestamp(seg.end_time) - parseTimestamp(seg.start_time);
  seg.overlays.forEach(ov => {
    if (ov.appear_at_seconds + ov.duration_seconds > segDur) {
      errors.push(`${short.short_id} / ${seg.segment_id} / overlay ${ov.motion_graphic_id}: overlay end (${ov.appear_at_seconds + ov.duration_seconds}s) exceeds segment duration (${segDur.toFixed(1)}s).`);
    }
  });
});

// Validate all motion_graphic_ids against template-registry
short.segments.forEach(seg => {
  seg.overlays.forEach(ov => {
    if (!registry[ov.motion_graphic_id]) {
      errors.push(`${short.short_id} / ${seg.segment_id}: unknown motion_graphic_id "${ov.motion_graphic_id}" — not in template-registry.json.`);
    }
  });
});
```

---

## Build Order for Claude Code

Work in this sequence. Do not start a step until the previous step passes all tests.

### SS-1: Zod schema extension (1 day)
- Add ShortSegment, ShortHook, ShortCTA, ShortOverlay, ShortCaptionStyle interfaces
- Extend the shorts array schema in editListParser.ts to accept new structure
- Add backward compatibility: old start_time/end_time schema accepted but flagged as deprecated
- Add all validation rules above
- Write tests: valid new schema parses, deprecated schema warns, over-45s rejects, overlay timing violation rejects
- Run pnpm test — all existing tests must still pass

### SS-2: FFmpeg segment assembly (3 days — highest risk)
- New function: buildShortsSegmentArgs() — takes segments[], returns concat filter_complex
- Per-segment: trim, scale to 1080x1920, apply transition effect
- Concat with transitions between segments
- Overlay motion graphics per segment (timed relative to segment start, not source)
- Write pure unit tests for argument builders before any end-to-end render
- Smoke check: render a 4-segment test short headlessly and verify output duration and transitions
- Run pnpm test

### SS-3: Portrait-safe caption system for shorts (2 days)
- New function: buildShortsCaptions() — takes segments[], VTT word timings, caption_style
- Extract word-level timings from VTT for each segment's time range
- Re-offset to assembled timeline position
- Generate ASS with shorts_bold style: 920px wrap, 64px, centred, word-by-word karaoke
- Apply caption_emphasis highlights via ASS colour override
- Write tests: wrap width never exceeds 920px, emphasis words get colour tag, timing offsets are correct
- Smoke check: render a short with captions and verify no caption overflow in portrait frame
- Run pnpm test

### SS-4: Edit Director prompt update (1 day)
- Add Shorts Schema v2 instructions section to the Edit Director prompt
- Test against Sweet Relief transcript — regenerate shorts using new prompt
- Verify new JSON uses segments[] structure
- Validate through parseEditList — must pass with 0 errors

### SS-5: UI updates (1 day)
- Shorts inspector: show segment list instead of start/end time fields
- Each segment row: source timecode range, duration, energy badge, transition label
- Segment overlays: expandable list per segment
- Add/remove segments in inspector
- Run pnpm test

### SS-6: End-to-end test (1 day)
- Re-run Sweet Relief short with new schema
- Verify: 4+ segments, total under 45s, transitions visible, captions in frame, overlays timed correctly
- Compare against manually edited reference if available
- All 426+ tests passing

---

## What NOT to Build in This Spec

- Speaker detection / automatic face framing (future)
- AI-generated B-roll or image generation (future)
- Platform-native upload API (future)
- Remotion-based animated statistics (v3)
- Music bed under shorts (v3 — after music library is built)

---

## Success Criteria

Shorts Schema v2 is complete when:

1. A short with 5 segments from different parts of the source recording renders correctly as a single assembled video
2. Total duration is under 45 seconds and the parser rejects anything over
3. Transitions between segments are visible and match the transition_out values
4. Captions are word-by-word, portrait-safe (no overflow), with emphasis highlights
5. Motion graphic overlays are timed relative to their segment start, not the source recording
6. The Edit Director produces v2 schema JSON for all new shorts
7. Old v1 shorts schema is accepted with a deprecation warning but not rejected
8. All existing tests pass plus new tests for every new module

---

*File location: docs/CADS_Shorts_Schema_v2.md*
*Hand to Claude Code when ready to begin SS-1.*
