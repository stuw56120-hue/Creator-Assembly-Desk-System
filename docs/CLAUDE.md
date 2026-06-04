# C.A.D.S. — Claude Code Master Briefing
## Come And Discuss Spurs / Creator Automated Development System
### Last updated: 03 June 2026

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

5. **Run `pnpm test`.** 204 tests must still pass after every step. Every new step must add its own tests. If tests fail, fix them before presenting.

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

---

## WHAT HAS BEEN BUILT — DO NOT REBUILD ANY OF THIS

The entire CADS v2 build order (all 19 steps) plus the Asset Onboarding System addendum plus the full ingest flow are complete. **204 tests pass across 16 test files.** The app is a real end-to-end product.

### Completed and working:
- Electron + React shell (boots cleanly)
- Full app router: **Setup → New Project (Ingest) → Import → Editor**
- Setup screen — one-time Projects folder + Asset Library folder pickers (persisted to `userData/cads-settings.json`)
- Ingest screen — drag in Zoom MP4 + optional VTT, language + Whisper model selector, Go button, live terminal log, green Ready screen with Open Submission Folder button
- Import screen — paste JSON or browse for JSON file, validation with inline errors, "Load sample project" shortcut
- Timeline editor — all tracks (cuts, motion graphics, chapters, shorts, images)
- Asset library + onboarding UI
- Image processing worker (original, blur, cutout variants via rembg — ~176MB model already downloaded)
- Background removal (rembg, local, fully offline)
- Motion graphics via Hyperframes CLI (topic_banner, lower_third, subscribe_flash, quote_card, intro_title, punch_in, meme_pop_in, side_panel_image)
- Newly installed Hyperframes components (caption_highlight, caption_kinetic_slam, caption_texture, grain_overlay, whip_pan, x_post) — registered in template-registry.json, **not yet wired into render pipeline**
- FFmpeg render pipeline — long-form + shorts + proxy + thumbnails
- Keyboard shortcuts (Space, arrows, Delete, Ctrl+Z/Y)
- Polish — warning badges, confidence opacity, unresolved counter
- Whisper transcription worker (faster-whisper, CPU/int8, VAD filter, streams progress to UI)
- IPC: settings:get/set, dialog:pickFolder/pickFile, project:openPath/readText, ingest:run + ingest:log streaming, render:longform/short/proxy/thumbnail
- `loadProject.ts` — shared module for loading edit list into editor stores
- `useProjectBootstrap` has been deleted — the dev seed is gone, real projects only
- News Mode v1 (NM-1 through NM-15) — full dual-variant news pipeline, Azure TTS, beat-relative timing, variant switcher, BeatInspector, music sidechain, Ken Burns render

### The dev seed is gone. The editor only opens after a real import or "Load sample project".

### Still to build (out of scope for executed build order — do these only if asked):
- Project save/reopen of an editor snapshot (mid-edit persistence)
- Per-short approval queue UI (render:short IPC exists, but the Shorts render button only does long-form currently)
- The config/ preset files
- Full render pipeline wiring for the six newly installed Hyperframes components — **this is NM2-1**

---

## FIRST REAL TEST — READY TO RUN NOW

The app is ready for its first real run:

1. `pnpm dev` in `C:\Users\statt\cads`
2. Pick Projects folder and Asset Library folder on Setup screen
3. New Project — drag in "Sweet Relief" Zoom MP4 + VTT
4. Hit Go — Whisper runs (base model recommended, tiny for testing only)
5. Open Submission Folder — hand transcript + audio to the CADS customGPT on ChatGPT
6. Import the JSON the customGPT returns
7. Review the timeline, approve, render

"Sweet Relief" is the most recent CADS (Come And Discuss Spurs) episode. Stuart has already edited it manually, so the CADS output can be directly compared against the manual edit. Evaluation criteria: time saved, caption accuracy, image placement, cut naturalness, shorts quality.

**Do not begin News Mode v2 work until this test is complete and any issues are fixed.**

---

## WHAT TO BUILD NEXT — NEWS MODE v2

News Mode v2 generalises the existing News Mode pipeline for any news subject, adds Getty Images as a licensed image source, introduces the parallax cutout visual treatment, wires the six new Hyperframes components into the render pipeline, and adds a YouTube Shorts export variant with cover frame selector.

**News Mode v2 is additive only. No existing v1 file is modified unless explicitly stated below.**

### Build order — follow exactly, each phase depends on the previous:

---

### NM2-1: Wire six Hyperframes components into render pipeline (2 days)

**Goal:** The six components installed in `compositions/components/` and `compositions/` must render correctly in the FFmpeg pipeline.

**Files:**
- `compositions/components/caption-highlight.html`
- `compositions/components/caption-kinetic-slam.html`
- `compositions/components/caption-texture.html`
- `compositions/components/grain-overlay.html`
- `compositions/whip-pan.html`
- `compositions/x-post.html`

**Tasks:**
- Read each file and confirm the param binding mechanism (data-composition-variables or hardcoded replaceable values)
- Add each component to the Hyperframes CLI invocation path in the render pipeline
- Verify `whip_pan` and `x_post` at 1920x1080 — if not natively vertical, apply a rotation/reframe transform at render time for 9:16 output
- Add `grain_overlay` as a project-level persistent layer (not per-beat) in the FFmpeg filter_complex
- Add `caption_highlight` and `caption_kinetic_slam` as selectable caption styles in BeatInspector
- Add `caption_texture` with texture enum selector (lava, marble, metal, wood, concrete, rock)
- Add `whip_pan` as a selectable transition in BeatInspector
- Add `x_post` as a selectable overlay in BeatInspector with fields: display_name, handle, tweet_text, likes, retweets
- Write tests for each component's render argument builder

**Success criteria:** End-to-end render with each component active produces a valid MP4 with no black frames or render errors.

---

### NM2-2: Getty Images API integration (3 days)

**Goal:** Users can search and download licensed Getty images directly into project image slots.

**Tasks:**
- Add Getty API key field to Settings screen, stored in `userData/cads-settings.json` alongside Azure credentials — never in project files
- Extend IPC handlers with `getty:search({ query, per_page })` and `getty:download({ asset_id, slot_path })`
- Add "Search Getty" button to each slot row in the Image Collection Screen
- Inline search panel: keyword input (pre-populated from director's slot description), results grid (thumbnail, licence type, photographer credit)
- On selection: download asset to slot path, set `rights_status` to `"getty_licensed"`, trigger existing image processing pipeline (original → blur → cutout variants)
- Getty-licensed slots show no rights warning anywhere in the UI or export flow
- Graceful fallback: if Getty API call fails (key missing, network error, rate limit), show plain-English error and allow manual upload instead — never block the workflow
- Add `"getty_licensed"` to the `rights_status` enum in the Zod schema
- Write tests for IPC handlers with mocked Getty responses

**Success criteria:** A Getty image can be searched, selected, downloaded, processed into three variants, and used in a render without triggering any rights warning.

---

### NM2-3: Parallax cutout treatment (2 days)

**Goal:** A new image treatment that layers blur background and cutout foreground with differential Ken Burns motion, creating a depth parallax effect.

**Tasks:**
- Add `"parallax_cutout"` to the `image_treatment` enum on beat events
- FFmpeg filter_complex: two zoompan inputs — blur layer at specified intensity, cutout layer at intensity stepped up one level (subtle→medium, medium→strong, strong→strong)
- Cutout layer centred and slightly scaled up (1.05x) relative to blur layer
- BeatInspector: add "Parallax Cutout" to treatment selector, shown only when cutout variant exists for the slot
- Validation: reject `parallax_cutout` if cutout variant is missing for the slot — plain-English error: "Parallax cutout requires a background-removed image. The background removal for this slot failed or has not been run. Select a different treatment or re-process the image."
- Write tests for the render argument builder for parallax_cutout
- Write tests for the validation rejection case

**Success criteria:** A beat with `parallax_cutout` renders with visible depth separation between background and foreground layers.

---

### NM2-4: Dual-variant schema and export rename (2 days)

**Goal:** Formalise the two variants as `tiktok` and `shorts` with appropriate pacing and export targets.

**Tasks:**
- Rename internal variant keys from `calm`/`hectic` to `shorts`/`tiktok` — update all references in the codebase
- Update variant switcher UI labels: "TikTok | Shorts"
- Update toolbar title: "Episode Title · TikTok" / "· Shorts"
- Update approval buttons: "Approve TikTok" / "Approve Shorts"
- Update status indicator: "TikTok: approved | Shorts: 3 issues remaining"
- Extend `video_project.json` Zod schema: `variants.tiktok` and `variants.shorts` each contain `script`, `timeline`, `captions`, `callouts`, `audio`, `publish`
- Shared at project root: `source`, `assets`, `missing_assets`, `warnings`
- Update editListParser.ts to accept the new variant key names
- Update all tests that reference calm/hectic variant keys

**Success criteria:** All existing tests pass with renamed variants. Variant switcher shows correct labels.

---

### NM2-5: Generalise News Director prompt (3 days)

**Goal:** The News Director customGPT works for any news subject, not just Spurs.

**Tasks:**
- Remove all Spurs-specific instructions and references from the News Director system prompt
- Replace with subject-agnostic framing: "You are a News Director. Your subject is [SUBJECT]. Write as if your audience follows [SUBJECT] closely."
- Add TikTok variant brief: 30-45 seconds, scroll-stopping opening hook, single-word Kinetic Slam on first beat, aggressive pacing, Whip Pan transitions, Highlight captions
- Add Shorts variant brief: 55-60 seconds, contextual opening (who/what/where/when in first beat), measured pacing, standard captions, source attribution prominent in final beat
- Enforce: two genuinely different scripts — not paraphrases. Same facts, different opening strategy, different sentence rhythm, different beat count.
- Add parallax_cutout to permitted image_treatment values with explicit prohibition: "Never use parallax_cutout for crowd shots, wide shots, or any image where a single clear subject cannot be isolated."
- Add the six new Hyperframes components to the director's component catalogue with usage rules
- Test against 3 non-Spurs articles (suggested: Premier League match report, technology story, human interest story)
- Document the final prompt in: `prompts/news-director-v2.md`

**Success criteria:** Three test articles produce usable dual-variant JSON with no schema validation errors and no Spurs-specific language in the output.

---

### NM2-6: Cover frame selector for Shorts export (1 day)

**Goal:** Users can pick a cover frame before the Shorts MP4 is finalised.

**Tasks:**
- After Shorts render completes, show a frame scrubber modal before writing the final file
- Scrubber shows the rendered video, user can scrub to any frame
- "Use this frame" button exports the selected frame as `<project_slug>_shorts_cover.jpg` in the renders folder
- "Skip" option exports the MP4 without a cover frame JPEG
- Cover frame modal only appears for the Shorts variant — TikTok export is direct

**Success criteria:** Shorts export produces both an MP4 and a correctly-named cover frame JPEG.

---

### NM2-7: Export presets (1 day)

**Goal:** Two named export presets produce correctly-spec'd output for each platform.

**Tasks:**
- Define two export presets in `config/export-presets.json`:
  - `tiktok`: 1080x1920, 30fps, H.264, AAC, no cover frame
  - `shorts`: 1080x1920, 30fps, H.264, AAC, cover frame selector
- "Render Both" applies the correct preset to each variant and runs sequentially
- Output filenames: `<project_slug>_tiktok.mp4` and `<project_slug>_shorts.mp4`
- Write tests for preset application in the render argument builder

**Success criteria:** "Render Both" produces two correctly-named, correctly-spec'd MP4 files.

---

### NM2-8: Polish and end-to-end test (3 days)

**Goal:** The complete pipeline works cleanly on real articles across different subjects.

**Tasks:**
- Grain overlay: confirm it persists correctly across all beats in both variants at opacity 0.15
- Caption style defaults: both variants default to caption_highlight (user can override per beat)
- Attribution lower-third: "Based on reporting from [source]" — automatic on final beat, overridable per project, default ON for both variants
- Rights check at export: if any image slot has rights_status of "unknown" at render time, show warning modal listing affected slots — user can proceed or cancel
- Error states: Getty API failure, rembg failure on parallax_cutout slot, Hyperframes component render failure — all produce plain-English errors, none crash the app
- Run end-to-end test on 3 articles from different subject areas — complete pipeline from article capture to dual MP4 export
- All 204 original tests still passing plus new tests for every new module

**Success criteria:** Three articles from different subjects complete the full pipeline without error. Both variants render correctly. All tests pass.

---

## ARCHITECTURAL RULES — NEVER VIOLATE

1. **News Mode v2 is additive only.** Never modify existing recording-mode code paths. Never modify News Mode v1 files unless explicitly listed in a phase above.
2. **Error messages are for Stuart, not developers.** Plain English, actionable. No stack traces in the UI.
3. **TTS cache is sacred.** Check hash before every Azure call. Never re-bill for unchanged text.
4. **Beat-relative timing for news projects.** CADS computes absolute timecodes. The customGPT never does cumulative arithmetic.
5. **Image processing is non-destructive.** The original upload is never deleted or overwritten.
6. **Getty API key never enters a project file.** Stored in userData only.
7. **Parallax cutout requires a valid cutout variant.** Never attempt the FFmpeg composite if the cutout variant is missing — validate first, fail with a plain-English error.
8. **Run `pnpm test` after every phase.** 204 original tests must continue to pass. Every new phase adds its own tests.
9. **Follow existing test conventions.** Vitest, mocked IPC, deterministic fixtures.
10. **Don't ask Stuart about technical decisions.** He is not a developer. Make the correct choice, document it in a comment, move on. Only surface genuine product/UX decisions.
11. **The music sidechain needs real listening.** Do not change sidechain parameters without asking Stuart to listen first.
12. **Whip Pan and X Post vertical compatibility must be confirmed in NM2-1 before any other phase uses them.**

---

## FOOTBALL TERMINOLOGY — KNOWN ZOOM TRANSCRIPTION ERRORS

The podcasts are about Tottenham Hotspur (Spurs). Zoom regularly mangles:
- Kulusevski → "Kool oh sev-ski" or similar
- Son Heung-min → various
- Postecoglou → various

A Spurs-specific find-and-replace dictionary is a future enhancement. Do not build it now.

---

## WHAT NOT TO BUILD YET

- Multi-language TTS
- Library catalogue auto-refresh (user-triggered only)
- Application-wide TTS cache (per-project only)
- Bokeh depth-aware blur (Gaussian only)
- Music library curation screen
- AI-generated backdrops for cutout images (solid colour only)
- AI-generated images for missing slots
- Site-specific Chrome extension HTML overrides (Readability only)
- Library management / news_inbox promotion UI (manual only)
- Direct TikTok or YouTube upload API
- Reddit Post Card component wiring (deferred)
- Automatic thumbnail generation for YouTube long-form
- Project save/reopen of mid-edit snapshots
- Per-short approval queue UI
- Multi-user access or creator marketplace

---

## APPROVAL PROMPTS — HOW TO HANDLE THEM

- **Say Yes** to: test runs, builds, file operations within the project, smoke tests, model downloads, cleanup
- **Say No** to: publishing to the internet, modifying files outside `C:\Users\statt\cads` or `C:\Video Editor\`, writing API keys or credentials to disk unencrypted
- **"Yes and don't ask again for pnpm exec"** — safe, it's just test runs
- **"Yes and don't ask again for Remove-Item"** — safe, it's just temp file cleanup
- **"Yes and don't ask again for python workers/..."** — safe, it's just the transcription worker

---

*End of briefing. This file lives at `C:\Users\statt\cads\CLAUDE.md` and is read automatically by Claude Code at the start of every session.*
