# C.A.D.S. — Asset Onboarding System
## Specification Addendum v2.1 + Claude Code Build Prompt

---

## Overview

This addendum adds the **Asset Onboarding System** to C.A.D.S. It slots between
Step 2 (customGPT JSON import) and Step 3 (motion graphics build) in the existing
workflow. The customGPT specifies exactly which images are needed; C.A.D.S.
presents an upload screen, processes each image into three variants automatically,
and only then proceeds to the timeline.

---

## Workflow Position

```
[Step 2] Import customGPT JSON
              ↓
    ┌─────────────────────────┐
    │  NEW: Asset Onboarding  │  ← This addendum
    └─────────────────────────┘
              ↓
[Step 3] Build motion graphics
              ↓
[Step 4] Timeline editor opens
```

---

## Part 1 — customGPT JSON Schema Extension

### New top-level field: `required_assets`

Add to `EditListSchema` in `src/project/editListParser.ts`:

```typescript
export const RequiredAssetSchema = z.object({
  asset_id:           z.string(),          // e.g. "asset_headshot"
  purpose:            z.string(),          // plain English — shown to user
  suggested_filename: z.string(),          // e.g. "headshot" (no extension)
  used_in:            z.array(z.string()).default([]), // overlay/mg IDs that reference it
  optional:           z.boolean().default(false),
}).passthrough();

// Add to EditListSchema:
required_assets: z.array(RequiredAssetSchema).default([]),
```

### Example customGPT output

```json
{
  "required_assets": [
    {
      "asset_id": "asset_headshot",
      "purpose": "Your headshot or profile photo — used as a lower-third background",
      "suggested_filename": "headshot",
      "used_in": ["overlay_003", "overlay_007"],
      "optional": false
    },
    {
      "asset_id": "asset_logo",
      "purpose": "Your channel or brand logo — appears on the intro title card",
      "suggested_filename": "brand-logo",
      "used_in": ["overlay_001"],
      "optional": false
    },
    {
      "asset_id": "asset_bg_scene",
      "purpose": "A background scene or location photo for B-roll overlays",
      "suggested_filename": "background-scene",
      "used_in": ["overlay_005", "overlay_009"],
      "optional": true
    }
  ]
}
```

The customGPT system prompt must be updated to include the `required_assets`
schema so it outputs this section. Include `RequiredAssetSchema` in the
customGPT's context.

---

## Part 2 — Image Processing Pipeline

### Three variants produced per upload

Every image the user uploads is automatically processed into exactly three files,
stored in the Asset Library under a shared `asset_group_id`:

| Variant | Filename pattern | Description |
|---|---|---|
| `original` | `{suggested_filename}.{ext}` | Original image, reformatted and renamed |
| `nobg` | `{suggested_filename}-nobg.png` | Background removed (transparent PNG) |
| `bg-blur` | `{suggested_filename}-bg-blur.jpg` | Sharp subject on Gaussian-blurred background |

### Processing steps

**Background removal** — uses the `rembg` Python library, running entirely locally
with no API calls. Model: `u2net` (bundled with rembg, ~170MB, downloads on first
use). Output is a transparent PNG.

**Bokeh / background blur** — compositing pipeline:
1. Take the original image
2. Apply a strong Gaussian blur to the entire image (radius: 25px) using Pillow
3. Composite the `nobg` (transparent) version back on top at 100% opacity and 100% scale
4. Flatten to JPEG at quality 92

This produces a portrait-mode effect: sharp subject, soft background.

### Python worker: `workers/process_image_worker.py`

```python
# Called by the Electron IPC handler via spawn
# Args: --input <path> --output-dir <dir> --filename <suggested_filename>
# Outputs: JSON to stdout — { original, nobg, bg_blur, width, height, hasAlpha }
```

Dependencies to add to `requirements.txt`:
```
faster-whisper>=1.0.0
rembg>=2.0.57
Pillow>=10.0.0
onnxruntime>=1.16.0
```

**Important:** `rembg` downloads the `u2net.onnx` model (~170MB) on first run to
`~/.u2net/`. The IPC handler must detect a first-run and show a "Downloading AI
model for background removal (one-time, ~170MB)..." message in the UI. Subsequent
runs are instant.

### Worker contract

```python
#!/usr/bin/env python3
"""
C.A.D.S. image processing worker.
Usage: python process_image_worker.py --input <path> --output-dir <dir> --filename <name>
Outputs JSON to stdout on completion, errors to stderr.
"""
import argparse, json, sys
from pathlib import Path
from PIL import Image, ImageFilter
from rembg import remove

def process(input_path: Path, output_dir: Path, filename: str) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # 1. Load and save original (converted to RGB JPEG if not PNG/transparent)
    img = Image.open(input_path).convert("RGBA")
    
    # Determine if source has meaningful transparency
    has_alpha = img.mode == "RGBA" and img.split()[3].getextrema()[0] < 255
    
    # Save original as-is (renamed)
    ext = ".png" if has_alpha else ".jpg"
    original_path = output_dir / f"{filename}{ext}"
    if has_alpha:
        img.save(original_path, "PNG")
    else:
        img.convert("RGB").save(original_path, "JPEG", quality=95)
    
    # 2. Background removal
    nobg_path = output_dir / f"{filename}-nobg.png"
    nobg_bytes = remove(img.tobytes(), width=img.width, height=img.height)
    # Use rembg's high-level API instead:
    with open(input_path, "rb") as f:
        nobg_result = remove(f.read())
    nobg_path.write_bytes(nobg_result)
    nobg_img = Image.open(nobg_path).convert("RGBA")
    
    # 3. Bokeh blur composite
    bgblur_path = output_dir / f"{filename}-bg-blur.jpg"
    base = img.convert("RGB")
    blurred = base.filter(ImageFilter.GaussianBlur(radius=25))
    # Composite: paste nobg (with alpha) over blurred base
    composite = blurred.copy()
    composite.paste(nobg_img, (0, 0), nobg_img.split()[3])
    composite.save(bgblur_path, "JPEG", quality=92)
    
    return {
        "original":  str(original_path),
        "nobg":      str(nobg_path),
        "bg_blur":   str(bgblur_path),
        "width":     img.width,
        "height":    img.height,
        "has_alpha": has_alpha,
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",      required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--filename",   required=True)
    args = parser.parse_args()
    
    try:
        result = process(Path(args.input), Path(args.output_dir), args.filename)
        print(json.dumps(result), flush=True)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr, flush=True)
        sys.exit(1)
```

---

## Part 3 — Electron IPC Handler

### `electron/ipc/imageProcessingHandlers.ts`

```typescript
// New IPC channels:
ipcMain.handle("image:upload", async (_event, { filePath, assetId, suggestedFilename }) => {
  // 1. Detect first-run (u2net model not yet downloaded)
  // 2. If first-run, send progress event: "image:model-download-progress"
  // 3. Spawn process_image_worker.py
  // 4. Stream stdout for progress lines
  // 5. On completion, parse JSON result
  // 6. Add all three variants to library_index.json under shared asset_group_id
  // 7. Return { original, nobg, bgBlur, assetGroupId }
})

ipcMain.handle("image:check-model", async () => {
  // Returns { downloaded: boolean, sizeMb: number }
  // Checks for ~/.u2net/u2net.onnx
})
```

### Asset Library record shape for processed images

Three `LibraryAsset` records are created per upload, linked by `assetGroupId`:

```typescript
interface ProcessedImageGroup {
  assetGroupId: string;       // e.g. "group_headshot"
  assetId: string;            // the required_asset's asset_id
  suggestedFilename: string;
  variants: {
    original: LibraryAsset;
    nobg:     LibraryAsset;   // category: "image", hasAlpha: true
    bgBlur:   LibraryAsset;   // category: "image", hasAlpha: false
  };
}
```

In `library_index.json`, each variant is a normal `LibraryAsset` entry.
An additional `asset_groups` array in the index links them:

```json
{
  "assets": [ ...all individual LibraryAsset records... ],
  "asset_groups": [
    {
      "asset_group_id": "group_headshot",
      "asset_id": "asset_headshot",
      "suggested_filename": "headshot",
      "variants": {
        "original": "asset_abc111",
        "nobg":     "asset_abc222",
        "bg_blur":  "asset_abc333"
      }
    }
  ]
}
```

---

## Part 4 — Asset Onboarding UI

### `src/onboarding/AssetOnboarding.tsx`

This screen replaces the timeline during the gap between JSON import and the
timeline opening. It is shown whenever `required_assets.length > 0` and any
asset is not yet fulfilled.

### Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  C.A.D.S.                                    Sweet Relief           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Before we build your edit, we need a few images.                  │
│  The customGPT has identified 3 images needed for this video.      │
│  Upload each one — C.A.D.S. will process it automatically.         │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ ☐  Your headshot or profile photo                               │ │
│ │    Saves as: headshot.jpg  ·  Used in 2 overlays               │ │
│ │                                              [Upload image ↑]   │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ ⟳  Processing your headshot...                                  │ │
│ │    ████████████░░░░░░  Removing background...  67%              │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ ✓  Your channel or brand logo                                   │ │
│ │    headshot.jpg  ·  headshot-nobg.png  ·  headshot-bg-blur.jpg  │ │
│ │    [▣ original] [▣ no bg] [▣ bokeh]    Used in 1 overlay        │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ ○  Background scene photo                    OPTIONAL           │ │
│ │    Saves as: background-scene.jpg  ·  Used in 2 overlays        │ │
│ │                                              [Upload image ↑]   │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ✓ 1 of 3 assets ready                                             │
│  ⟳ 1 processing                                                    │
│  ○ 1 optional / skippable                                          │
│                                                                     │
│                        [Skip optional] [Continue to edit →]        │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│  You can add more images any time from the Asset Library.           │
└─────────────────────────────────────────────────────────────────────┘
```

### State per asset row

```typescript
type AssetRowStatus =
  | "pending"       // not yet uploaded
  | "uploading"     // file selected, being read
  | "processing"    // Python worker running
  | "done"          // all three variants created
  | "error";        // worker failed

interface AssetRowState {
  assetId: string;
  status: AssetRowStatus;
  progress?: { stage: string; percent: number };
  variants?: { original: string; nobg: string; bgBlur: string };
  error?: string;
}
```

### Behaviour rules

- **Continue to edit** is enabled when all NON-optional assets are `done`
- **Skip optional** button skips remaining optional assets and enables Continue
- A required (non-optional) asset cannot be skipped — the button stays grey
- If a row errors, show the error inline with a Retry button
- If the u2net model has not been downloaded yet, show a one-time banner:
  > "First-time setup: C.A.D.S. needs to download a ~170MB AI model for background
  > removal. This happens once only." with a Download button that triggers
  > the model fetch before the first upload starts
- After processing, the three thumbnail previews are shown inline in the row
  so the user can see what was produced before continuing
- Accepted file types: `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`
  Rejected with a clear message: `.mp4`, `.mov`, `.gif`, `.pdf`, `.docx`, etc.

### First-time model download flow

```
[Download AI model (170MB, one-time)]
         ↓
  Progress bar: Downloading u2net.onnx...  ████░░░░  47%
         ↓
  ✓ Model ready — you can now upload images
```

After download, the button disappears and is never shown again for this machine.

---

## Part 5 — Zustand Store Extension

### `src/onboarding/onboardingStore.ts`

New Zustand store — does not affect projectStore or assetStore:

```typescript
interface OnboardingState {
  requiredAssets: RequiredAsset[];          // from parsed edit list
  rows: Record<string, AssetRowState>;      // keyed by asset_id
  modelReady: boolean;                      // u2net downloaded
  allRequiredDone: boolean;                 // derived

  // Actions
  setRequiredAssets: (assets: RequiredAsset[]) => void;
  setRowStatus: (assetId: string, status: AssetRowStatus) => void;
  setRowProgress: (assetId: string, stage: string, percent: number) => void;
  setRowVariants: (assetId: string, variants: AssetRowVariants) => void;
  setRowError: (assetId: string, error: string) => void;
  setModelReady: (ready: boolean) => void;
  skipOptional: () => void;
}
```

---

## Part 6 — Integration Points

### In `src/project/editListParser.ts`

`parseEditList` already returns a typed `editList` object. After this change:
- `editList.required_assets` contains the array (empty `[]` if GPT didn't include it)
- No breaking change to existing tests

### In `src/EditorLayout.tsx`

Add a gate before the timeline renders:

```typescript
const { requiredAssets, allRequiredDone } = useOnboardingStore();
const editListLoaded = useProjectStore(s => s.events.length > 0);

if (editListLoaded && requiredAssets.length > 0 && !allRequiredDone) {
  return <AssetOnboarding />;
}
// else render normal editor...
```

### In the edit list import flow

When the user imports the JSON (file or paste), after `parseEditList` succeeds:
1. Call `onboardingStore.setRequiredAssets(editList.required_assets)`
2. Call `ipcRenderer.invoke("image:check-model")` to pre-check model status
3. Set `onboardingStore.setModelReady(result.downloaded)`
4. Then proceed to build the motion graphics queue as before

---

## Part 7 — Asset Library Display

Once assets are processed and the user is in the timeline editor, the Asset Library
shows a dedicated **Images** tab with grouped view:

```
Images tab:
┌─────────────────────────────────────┐
│ 🔍 Search images...                 │
├─────────────────────────────────────┤
│ headshot                            │
│ ┌────┐ ┌────┐ ┌────┐               │
│ │orig│ │nobg│ │blur│               │
│ └────┘ └────┘ └────┘               │
│                                     │
│ brand-logo                          │
│ ┌────┐ ┌────┐ ┌────┐               │
│ │orig│ │nobg│ │blur│               │
│ └────┘ └────┘ └────┘               │
└─────────────────────────────────────┘
```

Each thumbnail is individually draggable onto the timeline.

---

## Part 8 — File & Folder Structure

```
workers/
  process_image_worker.py        ← NEW
  transcribe_worker.py           ← existing

src/
  onboarding/
    AssetOnboarding.tsx          ← NEW — the full onboarding screen
    AssetOnboardingRow.tsx        ← NEW — single asset row component
    ModelDownloadBanner.tsx       ← NEW — first-time model download UI
    onboardingStore.ts            ← NEW — Zustand store

electron/ipc/
  imageProcessingHandlers.ts     ← NEW
  motionGraphicsHandlers.ts      ← existing
  assetHandlers.ts               ← existing (extend to include groups)

requirements.txt                 ← ADD: rembg>=2.0.57, Pillow>=10.0.0, onnxruntime>=1.16.0
```

---

## Part 9 — Build Order for Claude Code

Work through in this sequence. Run `pnpm test` after each step.

1. **`requirements.txt`** — Add `rembg`, `Pillow`, `onnxruntime`. Run
   `python -m pip install -r requirements.txt` to verify they install.

2. **`workers/process_image_worker.py`** — Implement per the contract above.
   Test manually:
   ```
   python workers/process_image_worker.py \
     --input test.jpg --output-dir ./tmp --filename test-asset
   ```
   Verify three output files are created and JSON is printed to stdout.

3. **`src/project/editListParser.ts`** — Add `RequiredAssetSchema` and
   `required_assets` to `EditListSchema`. Update fixture test to confirm
   `required_assets` parses (can be `[]` in Sweet Relief fixture — it predates
   this feature).

4. **`src/onboarding/onboardingStore.ts`** — Zustand store. Write tests:
   - `setRequiredAssets` populates rows with `pending` status
   - `allRequiredDone` is false when any non-optional row is not `done`
   - `allRequiredDone` is true when all non-optional rows are `done`
   - `skipOptional` marks all optional rows as `done`

5. **`electron/ipc/imageProcessingHandlers.ts`** — IPC handler. Wire into
   `electron/main.ts`. Extend `electron/preload.ts` with:
   ```typescript
   image: {
     checkModel: () => ipcRenderer.invoke("image:check-model"),
     upload: (args) => ipcRenderer.invoke("image:upload", args),
   }
   ```
   Extend `src/vite-env.d.ts` with the `image` API types.

6. **`src/onboarding/ModelDownloadBanner.tsx`** — First-time model download UI.

7. **`src/onboarding/AssetOnboardingRow.tsx`** — Single asset row. Handles:
   - Pending state (Upload button)
   - Processing state (progress bar with stage label and percentage)
   - Done state (three thumbnail previews)
   - Error state (error message + Retry button)
   - File type validation (reject non-images with clear message)

8. **`src/onboarding/AssetOnboarding.tsx`** — Full screen. Composes the rows,
   shows the summary counts, and the Continue / Skip optional buttons.

9. **`src/EditorLayout.tsx`** — Add the gate that shows `AssetOnboarding` when
   `required_assets.length > 0 && !allRequiredDone`.

10. **Edit list import flow** — Update wherever JSON import happens to call
    `onboardingStore.setRequiredAssets` and `image:check-model` after parse.

11. **Asset Library grouped display** — Update `AssetGrid` and `AssetLibrary` to
    render asset groups (original / nobg / bg-blur triads) when `asset_groups`
    are present in the library index.

---

## Tests to Write

### `onboardingStore.test.ts`
- `setRequiredAssets` creates one row per asset, all `pending`
- `allRequiredDone` false when any required row is not done
- `allRequiredDone` true when all required rows done (optional irrelevant)
- `skipOptional` flips optional pending rows to done
- `setRowError` sets status to error and stores message

### `editListParser.test.ts` additions
- Fixture with `required_assets` array parses cleanly
- Fixture without `required_assets` defaults to `[]` (no breaking change)
- `optional: true` is parsed correctly

### `process_image_worker` integration test (Python)
- Worker produces three files with correct naming
- Worker exits 0 on success
- Worker exits 1 and prints to stderr on bad input path
- Worker produces valid JSON on stdout

---

## Constraints

- **`rembg` runs fully locally** — no API key, no internet after the one-time
  model download. This is non-negotiable for privacy.
- **Never block the main process** — the Python worker is always spawned as a
  child process, never run in-process.
- **File type rejection is client-side first** — validate extension in the
  renderer before even sending to the main process. The main process validates
  again as a safety net.
- **The user's original upload is never deleted** — C.A.D.S. copies it into the
  library; what the user does with their Downloads folder is their business. Never
  touch the source file.
- **Processing is sequential per asset, parallel across assets** — if the user
  uploads two images quickly, process them one at a time per asset row but do not
  queue them behind each other globally.
- **`allRequiredDone` is the only gate** — optional assets never block progress.
  If `required_assets` is empty (old-format JSON, no asset requirements), the
  onboarding screen is skipped entirely and the timeline opens immediately.
