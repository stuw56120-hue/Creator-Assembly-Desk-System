/*
 * Loads a validated edit list into the editor stores: builds the timeline,
 * seeds the project + player + onboarding stores. Shared by the customGPT
 * import flow and the "load sample project" shortcut.
 */

import { parseEditList, type EditList, type MotionGraphicBuildJob } from "./editListParser";
import { buildTimeline } from "./timelineBuilder";
import { useProjectStore } from "./projectStore";
import { useAppStore } from "../app/appStore";
import { getTemplateRegistry } from "../motionGraphics/templateRegistry";
import { usePlayerStore } from "../player/playerStore";
import { useOnboardingStore } from "../onboarding/onboardingStore";
import { runMotionGraphicBuildQueue } from "../motionGraphics/buildQueueRunner";
import { isToolMissingError, useBuildAlertStore } from "../motionGraphics/buildAlertStore";
import { parseTranscript } from "./captions";
import { applyDisplayNameToEvents, humanizeSubject } from "./displayNames";
import type { ProjectSnapshot } from "./projectSnapshot";
import sweetRelief from "./__fixtures__/sweet-relief.json";

// Guards against launching the same project's build queue twice (e.g. a
// re-import) — keyed by the set of MG ids currently building.
const buildingIds = new Set<string>();

/**
 * Kick off the motion-graphic build queue in the background. Each MG is marked
 * "building", then "ready" with its WebM path (so the preview's placeholder
 * becomes the real graphic) or "error" on failure. Fire-and-forget — the editor
 * opens immediately and graphics fill in as they finish.
 */
export function startMotionGraphicBuilds(queue: MotionGraphicBuildJob[]): void {
  if (!window.cads?.motionGraphics?.build) return;
  const pending = queue.filter((job) => !buildingIds.has(job.mgId));
  if (pending.length === 0) return;
  pending.forEach((job) => buildingIds.add(job.mgId));

  void runMotionGraphicBuildQueue(
    pending,
    async (job) => {
      useProjectStore.getState().setMotionGraphicBuildStatus(job.mgId, "building");
      const result = await window.cads!.motionGraphics!.build({
        assetId: job.mgId,
        templateId: job.templateId,
        params: job.params,
        // Pass the project folder so a job carrying a background_image_id can be
        // resolved to a real image (resolveBackgroundParams strips the background
        // when no project folder is supplied). The inspector's rebuild/preview
        // already pass this; the import-time build must too, or background images
        // never reach the composition on the first render.
        projectFolder: useAppStore.getState().project?.projectDir ?? "",
      });
      return { assetPath: result.assetPath };
    },
    ({ outcome }) => {
      buildingIds.delete(outcome.mgId);
      if (outcome.ok && outcome.assetPath) {
        useProjectStore.getState().setMotionGraphicBuildStatus(outcome.mgId, "ready", outcome.assetPath);
      } else {
        useProjectStore.getState().setMotionGraphicBuildStatus(outcome.mgId, "error");
        const message = outcome.error ?? "unknown error";
        window.cads?.log?.error(`Motion graphic "${outcome.mgId}" failed to build: ${message}`);
        // A missing tool (e.g. Hyperframes) breaks every build — surface the
        // plain-English install message to the user once, not per graphic.
        if (isToolMissingError(message)) {
          useBuildAlertStore.getState().setMessage(message);
        }
      }
    },
  );
}

/**
 * Link collected player images to their timeline overlays.
 *
 * Reads every "done" onboarding row and pushes its image path onto the matching
 * image overlay events (matched by assetId), so the picture shows in the preview.
 * Defaults to the original variant — the OverlayInspector can switch treatment
 * later. Idempotent: safe to call after each upload and again before the editor.
 */
export function applyOnboardedImagesToTimeline(): void {
  const { rows } = useOnboardingStore.getState();
  const pathByAssetId: Record<string, string> = {};
  for (const [assetId, row] of Object.entries(rows)) {
    if (row.status !== "done" || !row.variants) continue;
    // Until the three-layer compositing system exists, player images show the
    // no-background (cutout) variant so they sit cleanly over the video; fall
    // back to the original if a cutout wasn't produced.
    pathByAssetId[assetId] = row.variants.nobg || row.variants.original;
  }
  useProjectStore.getState().setImageOverlayAssetPaths(pathByAssetId);
}

/**
 * Parse a plain-text transcript and replace the project's caption track.
 * Returns the number of caption segments loaded.
 */
export function applyTranscriptCaptions(text: string): number {
  const segments = parseTranscript(text);
  useProjectStore.getState().setCaptions(segments);
  return segments.length;
}

interface LibraryAssetIndex {
  id: string;
  absolutePath: string;
}
interface LibraryGroupIndex {
  asset_group_id: string;
  asset_id: string;
  suggested_filename: string;
  image_subject?: string;
  display_name?: string;
  variants: { original: string; nobg: string; bg_blur: string };
}
interface LibrarySnapshot {
  assets: LibraryAssetIndex[];
  groups: LibraryGroupIndex[];
}

async function scanLibrary(): Promise<LibrarySnapshot> {
  try {
    const res = await window.cads?.assets?.scan();
    if (!res || Array.isArray(res)) return { assets: [], groups: [] };
    return {
      assets: (res.assets ?? []) as LibraryAssetIndex[],
      groups: (res.asset_groups ?? []) as LibraryGroupIndex[],
    };
  } catch {
    return { assets: [], groups: [] };
  }
}

export async function applyEditList(
  editList: EditList,
  opts: { sourceVideoPath?: string; transcriptText?: string } = {},
): Promise<void> {
  const built = buildTimeline(editList);
  let events = built.events;
  const keepSegments = built.keepSegments;

  // Persisted library state — used both to skip already-uploaded players and to
  // recover their saved display names.
  const library = await scanLibrary();

  // Player display names: default humanised slug, overridden by any name saved
  // in the library. Rewrite the player reference into the events before load.
  const subjects = [
    ...new Set(
      editList.required_assets
        .map((a) => a.image_subject)
        .filter((s): s is string => Boolean(s)),
    ),
  ];
  const playerDisplayNames: Record<string, string> = {};
  for (const subject of subjects) {
    // Match by image_subject, falling back to the slug embedded in the group id
    // / suggested_filename — older groups have no image_subject (see setPlayerName).
    const slug = subject.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const saved = library.groups.find(
      (g) =>
        g.display_name &&
        (g.image_subject === subject ||
          g.asset_group_id === `group_${slug}` ||
          g.asset_group_id.startsWith(`group_${slug}-`) ||
          g.suggested_filename === slug ||
          (g.suggested_filename ?? "").startsWith(`${slug}-`)),
    )?.display_name;
    const name = saved || humanizeSubject(subject);
    playerDisplayNames[subject] = name;
    events = applyDisplayNameToEvents(events, subject, name);
  }

  // Seed the caption appearance from the edit list (longform.captions.style),
  // falling back to the clean podcast preset.
  const KNOWN_CAPTION_STYLES = ["clean_podcast", "bold_social", "quote_emphasis", "karaoke_highlight"];
  const editStyle = (editList.longform as { captions?: { style?: string } }).captions?.style;
  useProjectStore
    .getState()
    .setCaptionStyle(editStyle && KNOWN_CAPTION_STYLES.includes(editStyle) ? editStyle : "clean_podcast");

  useProjectStore.getState().loadTimeline({
    projectName: editList.project_name,
    durationSeconds: editList.metadata.duration_seconds,
    // Prefer the real copied source from ingest; fall back to the GPT's filename.
    sourceVideoPath: opts.sourceVideoPath ?? editList.metadata.primary_video ?? "",
    events,
    keepSegments,
    playerDisplayNames,
  });
  usePlayerStore.getState().setDuration(editList.metadata.duration_seconds);

  // Populate the caption track from the ingest/uploaded transcript, atomically
  // with the timeline load — so a re-import never leaves the timeline reset with
  // no captions. Applying again is idempotent (setCaptions replaces the track).
  if (opts.transcriptText) {
    applyTranscriptCaptions(opts.transcriptText);
  }

  const resolvedSource = opts.sourceVideoPath ?? editList.metadata.primary_video ?? "";
  window.cads?.log?.info(
    `Loaded "${editList.project_name}" — sourceVideoPath: ${resolvedSource || "(none)"}`,
  );

  useOnboardingStore.getState().setRequiredAssets(editList.required_assets);
  hydrateOnboardingFromLibrary(library);
  // Players already in the library are resolved now → show them immediately,
  // even if the user skips straight past onboarding.
  applyOnboardedImagesToTimeline();

  try {
    const model = await window.cads?.image?.checkModel();
    useOnboardingStore.getState().setModelReady(model?.downloaded ?? false);
  } catch {
    /* model check is best-effort */
  }
}

/**
 * Mark onboarding rows "done" for required assets whose images were already
 * processed in a previous session (matched by asset id / group), resolving the
 * three variant paths — so the user isn't asked to upload them again.
 *
 * Matching is STRICT — by the image_subject-derived asset_id / suggested_filename,
 * or an exact image_subject match. We deliberately do NOT fuzzy-match a nearby
 * on-disk slug: the JSON's image_subject is authoritative, so a stale,
 * mis-spelled group on disk (e.g. a Whisper-mangled "paulinha-action" left from
 * an earlier session) must never be substituted for the correct "palhinha".
 * Doing so surfaced the wrong slug in the chip and risked binding overlays to
 * the wrong player's images.
 */
function hydrateOnboardingFromLibrary(library: LibrarySnapshot): void {
  const pathById = new Map(library.assets.map((a) => [a.id, a.absolutePath]));
  const store = useOnboardingStore.getState();
  for (const required of store.requiredAssets) {
    // Strict match — used to resolve the THREE variants for THIS role.
    const strict = library.groups.find(
      (g) =>
        g.asset_id === required.asset_id ||
        g.asset_group_id === `group_${required.suggested_filename}`,
    );
    // Looser match by EXACT image_subject — used purely to surface the actual NAS
    // slug (the player's files may have been renamed on disk, so the JSON's
    // subject and the library's group id can diverge; we still want the chip to
    // show what's on disk). Exact-subject only — never a fuzzy mis-spelling.
    const subjectOnly =
      !strict && required.image_subject
        ? library.groups.find((g) => g.image_subject && g.image_subject === required.image_subject)
        : null;
    const matched = strict ?? subjectOnly;
    if (matched) {
      store.setRowLibraryMatch(required.asset_id, { suggestedFilename: matched.suggested_filename });
    }
    if (!strict) continue;
    const original = pathById.get(strict.variants.original);
    const nobg = pathById.get(strict.variants.nobg);
    const bgBlur = pathById.get(strict.variants.bg_blur);
    if (original && nobg && bgBlur) {
      store.setRowVariants(required.asset_id, { original, nobg, bgBlur });
    }
  }
}

/** Demo shortcut — load the bundled Sweet Relief fixture into the editor. */
export async function loadSampleProject(): Promise<void> {
  const result = parseEditList(sweetRelief, getTemplateRegistry());
  if (result.ok) {
    await applyEditList(result.editList);
    startMotionGraphicBuilds(result.buildQueue);
  }
}

/**
 * Reopen a saved project snapshot directly — the timeline already holds the
 * user's edits, so it is loaded as-is (no rebuild). Onboarding is skipped: a
 * saved project's images are already baked into its overlay events.
 */
export async function reopenProject(snapshot: ProjectSnapshot): Promise<void> {
  useProjectStore.getState().loadTimeline({
    projectName: snapshot.projectName,
    durationSeconds: snapshot.durationSeconds,
    sourceVideoPath: snapshot.sourceVideoPath,
    events: snapshot.events as never, // validated; passthrough keeps nested *Data
    keepSegments: snapshot.keepSegments,
    approved: snapshot.approved,
    playerDisplayNames: snapshot.playerDisplayNames,
  });
  usePlayerStore.getState().setDuration(snapshot.durationSeconds);
  useOnboardingStore.getState().setRequiredAssets([]); // already onboarded
}
