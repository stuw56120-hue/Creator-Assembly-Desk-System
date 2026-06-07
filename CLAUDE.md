# C.A.D.S. — Claude Code Master Briefing
## Come And Discuss Spurs / Creator Automated Development System
### Last updated: 07 June 2026

---

## WHO YOU ARE BUILDING FOR

Stuart runs two Tottenham Hotspur football podcasts:
- **CADS** (Come And Discuss Spurs) — frequently recorded, quick to edit
- **YAPS** (Yet Another Podcast about Spurs) — monthly, currently takes 1–2 days to edit manually

The goal is to reduce that 2-day YAPS edit to a 1–2 hour review-and-approve session. Stuart is not a developer — every error message must be plain English, never a stack trace. Stuart already has a library of football images ready to use.

---

## AUTONOMOUS WORKING STYLE — READ THIS FIRST

Work autonomously to completion. Stuart is not a developer. Do not ask him about implementation details, library choices, file structure decisions, or anything technical. Make the correct call, add a brief inline comment explaining why, and keep moving.

### Only stop and ask Stuart if:
- A decision would change the product behaviour he will see (a UX or feature decision, not a technical one)
- A file outside `C:\Users\statt\cads` or `C:\Video Editor\` would be modified or deleted
- A genuine ambiguity exists that would cause you to build the wrong thing entirely — and cannot be resolved by reading the existing codebase

### Never stop and ask Stuart about:
- Which library or package to use
- How to structure a file or module
- What to name a variable, function, or component
- How to handle an error internally
- Whether to write a test

### Before presenting any work as complete, you must:

1. **Reason from first principles.** For each component built, state what must be true for it to work correctly. Verify each assumption against the actual code. Do not assume it works because it compiled.

2. **Run smoke checks.** Execute the code. Observe real output. Do not present untested code as working. If the environment cannot run something, say so explicitly and state what was checked instead.

3. **Self-review.** Read your output as a critical reviewer. Fix any problem you would flag in someone else's work before presenting it. Do not present known issues without explicitly labelling them as known issues.

4. **Check integration points.** If new code touches existing systems, verify the join — the existing system receives what it expects, and the new code handles what the existing system returns.

5. **Run `pnpm test`.** 430 tests must still pass after every step. Every new step must add its own tests. If tests fail, fix them before presenting.

### Presenting completed work:
- Lead with what was built and whether it passed smoke checks and tests
- List any known limitations or deferred decisions with reasons
- Flag anything that requires a product or UX decision from Stuart
- Be direct. Do not pad the summary. Do not celebrate finishing.

---

## ENVIRONMENT

- **OS:** Windows 10 (Version 10.0.26200.8457)
- **Working directory:** `C:\Users\statt\cads`
- **GitHub:** https://github.com/stuw56120-hue/Creator-Assembly-Desk-System
- **Package manager:** pnpm
- **Node:** v24.16.0 | **npm:** v11.13.0
- **Git:** installed at `C:\Program Files\Git\cmd\git.exe`

---

## TRUE STATE OF THE CODEBASE — READ CAREFULLY

**430 tests pass across 31 test files. The app boots and runs.**

### What is built and working:
- Electron + React shell (boots cleanly)
- Full app router: **Setup → New Project (Ingest) → Import → Editor**
- Setup screen — one-time Projects folder + Asset Library folder pickers (persisted to `userData/cads-settings.json`)
- Ingest screen — drag in Zoom MP4 + optional VTT, language + Whisper model selector, Go button, live terminal log, green Ready screen with Open Submission Folder button
- Import screen — paste JSON or browse for JSON file, validation with inline errors, "Load sample project" shortcut
- Timeline editor — longform tracks (cuts, motion graphics, chapters, images)
- Asset library + onboarding UI + Clean Library button
- Image processing worker (original, blur, cutout variants via rembg — ~176MB model already downloaded)
- Background removal (rembg, local, fully offline)
- Motion graphics via Hyperframes CLI — eight templates working: topic_banner, lower_third, subscribe_flash, quote_card, intro_title, punch_in, meme_pop_in, side_panel_image
- MG transparency fix — libvpx-vp9 decoder flag applied in renderExporter.ts, confirmed working
- MG inspector — click MG in left panel to open inspector, opacity slider, background image param, rebuild button with spinner and error state, background indicator badge in list
- Six new Hyperframes components installed and registered in template-registry.json but NOT YET WIRED into render pipeline: caption_highlight, caption_kinetic_slam, caption_texture, grain_overlay, whip_pan, x_post
- FFmpeg render pipeline — longform render working, proxy, thumbnails
- Render Shorts button removed — longform render only
- Keyboard shortcuts (Space, arrows, Delete, Ctrl+Z/Y)
- Whisper transcription worker (faster-whisper, CPU/int8, VAD filter)
- IPC: settings:get/set, dialog:pickFolder/pickFile, project:openPath/readText, ingest:run + ingest:log streaming, render:longform/proxy/thumbnail
- Chapter titles default to top_left position
- Caption width enforced within portrait frame safe area
- Player image slug uses image_subject directly (fuzzy match removed)
- `loadProject.ts` — shared module for loading edit list into editor stores
- Sweet Relief test — completed successfully. Longform creator confirmed working end-to-end.

### What does NOT exist — do not reference or assume these are built:
- **News Mode** — not built. No BeatInspector, no Azure TTS integration, no beat-relative timing, no music sidechain, no news project type, no variant switcher. Spec documents exist in docs/ but zero implementation exists in src/.
- **Shorts Schema v2** — not built. The current shorts implementation is a basic clip (start_time/end_time) tacked onto the longform editor. The multi-segment aggressive shorts pipeline described in docs/CADS_Shorts_Schema_v2.md does not exist yet.
- **Getty Images API** — not built
- **Parallax cutout render** — not built (image processing produces the cutout variant but the FFmpeg two-layer composite is not implemented)
- **Music library** — not built
- **Loop detection** — not built
- **Colour grading** — not built

### Installed Hyperframes components — registered but not wired:
The following are in compositions/ and template-registry.json but produce no output in renders yet:
- caption_highlight, caption_kinetic_slam, caption_texture (in compositions/components/)
- grain_overlay (in compositions/components/)
- whip_pan, x_post (in compositions/ root)

---

## WHAT TO BUILD NEXT

The codebase has three planned additions in priority order. Build them in sequence — do not start the next until the previous is complete and tested.

---

### PHASE 1 — SHORTS SCHEMA V2

**Spec document:** `docs/CADS_Shorts_Schema_v2.md` — read this before starting.

The current shorts implementation is a single clip with overlays. It needs to become a multi-segment assembly pipeline for aggressive portrait short-form video.

This is a self-contained addition to the existing longform pipeline. It does not require News Mode, Azure TTS, or any audio generation. It draws from the same source recording as longform.

**Build order (read the spec for full detail):**

**SS-1: Zod schema extension (1 day)**
- Add ShortSegment, ShortHook, ShortCTA, ShortOverlay, ShortCaptionStyle interfaces
- Extend shorts array schema in editListParser.ts to accept segments[] structure
- Backward compatibility: old start_time/end_time schema accepted with deprecation warning
- Validation: reject shorts over 45 seconds, warn on fewer than 4 segments, reject overlay timing violations
- Tests: valid new schema parses, deprecated schema warns, over-45s rejects

**SS-2: FFmpeg segment assembly (3 days — highest risk)**
- New function: buildShortsSegmentArgs() — takes segments[], returns concat filter_complex
- Per-segment: trim, scale to 1080x1920, apply transition effect
- Concat with transitions between segments
- Overlay motion graphics per segment (timed relative to segment start)
- Write pure unit tests for argument builders BEFORE any end-to-end render
- Smoke check: render a 4-segment test short headlessly

**SS-3: Portrait-safe caption system (2 days)**
- New function: buildShortsCaptions() — takes segments[], VTT word timings, caption_style
- Extract word-level timings from VTT for each segment's time range
- Re-offset to assembled timeline position
- Generate ASS with shorts_bold style: 920px max width, 64px, centred, word-by-word
- Apply caption_emphasis highlights
- Tests: wrap width never exceeds 920px, emphasis words get colour tag, timing offsets correct

**SS-4: Two-pass short form workflow (2 days)**
- Theme selection screen between transcript upload and short import
- Pass 1: import theme proposals list (no JSON yet), user selects theme
- Pass 2: import full short JSON for selected theme
- Repeat for each theme
- This is a UI addition — does not change the render pipeline

**SS-5: UI updates (1 day)**
- Shorts inspector: show segment list instead of start/end time fields
- Each segment row: source timecode range, duration, energy badge, transition label
- Segment overlays: expandable list per segment

**SS-6: End-to-end test (1 day)**
- Re-run Sweet Relief with new schema from Agent 3 Short Form Director
- Verify: 4+ segments, total under 45s, transitions visible, captions in frame
- All 430+ tests passing

---

### PHASE 2 — NEWS MODE

**Spec documents:** `docs/NewsMode_v2_SDP.docx` and `docs/CADS_Asset_Onboarding_Spec_v2_2.md` — read both before starting.

News Mode is a completely separate pipeline from recording mode. It has no source recording. An article comes in, a script is generated by the News Director customGPT, Azure TTS voices it, images are sourced, and FFmpeg renders two portrait videos (TikTok and Shorts variants).

**News Mode does not share screens or pipeline code with the longform editor.** It is a new project type with its own ingest, its own timeline model (beats not cuts), its own inspector (BeatInspector not InspectorPanel), and its own render pipeline.

Do not begin News Mode until Shorts Schema v2 is complete and passing all tests.

**High-level build order (read the SDP for full detail):**

1. Data model — project_type: "news", beat and music TimelineEventKind, ImageSlot, VariantState
2. Zod schema for news edit list — beat schema, TTS character rules, validation
3. Azure TTS integration — IPC handler, SSML input, WAV output, content hash cache
4. Image Collection Screen — slot-based upload, Getty search, rembg processing
5. BeatInspector UI — beat editor with TTS text, audio player, image treatment selector
6. Ken Burns image motion — kburns param on beat events, FFmpeg zoompan
7. Parallax cutout render — two-layer FFmpeg composite (blur + cutout)
8. Music track — MusicInspector, sidechain ducking
9. Beat-relative motion graphic timing
10. Variant switcher — TikTok | Shorts toggle
11. News render pipeline — segment assembly, TTS concat, music mix, encode
12. Six Hyperframes components wired — caption_highlight, caption_kinetic_slam, caption_texture, grain_overlay, whip_pan, x_post
13. Export presets — tiktok and shorts named presets, cover frame selector for Shorts

---

### PHASE 3 — AUDIO AND VISUAL POLISH

Do not begin until News Mode is complete.

- Music library — watched folder, mood catalogue, loop management
- Loop pre-processing — pre-cut loops at target lengths (4s, 8s, 12s, 16s, 30s, 60s)
- Colour grading — normalisation pass across image pool, project-level grade presets
- WhisperX upgrade — faster transcription with better word-level alignment

---

## ARCHITECTURAL RULES — NEVER VIOLATE

1. **Error messages are for Stuart, not developers.** Plain English, actionable. No stack traces in the UI.
2. **Recording mode is untouchable.** Never modify existing longform pipeline code unless a bug is being fixed.
3. **Shorts Schema v2 is additive.** New schema, new render functions, new UI. Do not modify existing clip-based shorts code — deprecate it.
4. **News Mode is a separate project type.** It does not share screens with the longform editor. Adding news mode code must never touch recording-mode code paths.
5. **Image processing is non-destructive.** The original upload is never deleted or overwritten.
6. **TTS cache is sacred (when built).** Check content hash before every Azure call. Never re-bill for unchanged text.
7. **Beat-relative timing for news projects (when built).** CADS computes absolute timecodes. The customGPT never does cumulative arithmetic.
8. **Run `pnpm test` after every step.** 430 tests must continue to pass. Every new step adds its own tests.
9. **Follow existing test conventions.** Vitest, mocked IPC, deterministic fixtures.
10. **Don't ask Stuart about technical decisions.** He is not a developer. Make the correct choice, document it in a comment, move on. Only surface genuine product/UX decisions.
11. **The music sidechain needs real listening (when built).** Do not finalise sidechain parameters without Stuart listening to a test mix.
12. **Whip Pan and X Post vertical compatibility must be confirmed before use in any render.**

---

## FOOTBALL TERMINOLOGY — KNOWN ZOOM TRANSCRIPTION ERRORS

The podcasts are about Tottenham Hotspur (Spurs). Zoom and Whisper regularly mangle:
- Kulusevski → "Kool oh sev-ski" or similar
- Kinsky → "Kinski", "Kinske"
- Son Heung-min → various
- Postecoglou → various
- Palhinha → "Paulinha", "Polinho"
- Maddison → "James Madison"
- De Zerbi → "De Zaube", "Dazelle"
- Arnesen → "Arneson"

A Spurs-specific find-and-replace dictionary is a future enhancement to the ingest pipeline. Do not build it now — it is handled by the Agent 1 Transcript Cleaner customGPT.

---

## WHAT NOT TO BUILD YET

- Multi-language TTS
- Application-wide TTS cache (per-project only when TTS is built)
- Bokeh depth-aware blur (Gaussian only)
- AI-generated backdrops for cutout images (solid colour only)
- AI-generated images for missing slots
- Direct TikTok or YouTube upload API
- Reddit Post Card component wiring (deferred)
- Automatic thumbnail generation for YouTube long-form
- Project save/reopen of mid-edit snapshots
- Multi-user access or creator marketplace
- Getty Images API (deferred — free image sources first: Unsplash, Pexels, Wikimedia)
- Remotion integration (deferred to Phase 3+)

---

## APPROVAL PROMPTS — HOW TO HANDLE THEM

- **Say Yes** to: test runs, builds, file operations within the project, smoke tests, model downloads, cleanup
- **Say No** to: publishing to the internet, modifying files outside `C:\Users\statt\cads` or `C:\Video Editor\`, writing API keys or credentials to disk unencrypted
- **"Yes and don't ask again for pnpm exec"** — safe, it's just test runs
- **"Yes and don't ask again for Remove-Item"** — safe, it's just temp file cleanup
- **"Yes and don't ask again for python workers/..."** — safe, it's just the transcription worker

---

*End of briefing. This file lives at `C:\Users\statt\cads\CLAUDE.md` and is read automatically by Claude Code at the start of every session.*
*Last updated: 07 June 2026 — corrected to reflect true codebase state after Sweet Relief test.*
