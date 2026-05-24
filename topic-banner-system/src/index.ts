import { readFileSync, writeFileSync } from "fs";
import { parseArgs } from "util";
import { JobManifestSchema } from "./schema/job_manifest.js";
import { BannerEventSchema, type BannerEvent } from "./schema/banner_event.js";
import { resolveProfile } from "./detection/profiles.js";
import { runDetectionPipeline, msToTimecode } from "./detection/pipeline.js";
import { resolvePosition } from "./renderer/position.js";
import { resolveStartOffset } from "./renderer/timing.js";
import { applyScaleFactor } from "./renderer/render_context.js";
import { AuditLog } from "./lifecycle/audit_log.js";
import { createOpenAIEmbeddingFn, createMockEmbeddingFn } from "./embeddings.js";
import type { BannerStyle, BannerPosition, BoundingBox } from "./types.js";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    manifest: { type: "string" },
    out: { type: "string" },
    "embedding-model": { type: "string" },
  },
});

if (!values.manifest || !values.out) {
  console.error(
    "Usage: node dist/index.js --manifest <path> --out <path> [--embedding-model <model>]"
  );
  process.exit(1);
}

const rawManifest = JSON.parse(readFileSync(values.manifest, "utf-8"));
const manifest = JobManifestSchema.parse(rawManifest);

const profile = resolveProfile(
  manifest.detection_profile,
  manifest.threshold_overrides
);

const templateRegistry = JSON.parse(
  readFileSync(join(__dirname, "../config/banner_templates.json"), "utf-8")
);

const auditLog = new AuditLog();

const apiKey = process.env.OPENAI_API_KEY;
const embeddingModel = values["embedding-model"] ?? "text-embedding-3-small";

const getEmbedding = apiKey
  ? createOpenAIEmbeddingFn(apiKey, embeddingModel)
  : createMockEmbeddingFn();

if (!apiKey) {
  console.warn(
    "Warning: OPENAI_API_KEY not set — using mock embeddings. " +
      "Topic detection accuracy will be limited."
  );
}

const candidates = await runDetectionPipeline(
  manifest.transcript,
  profile,
  getEmbedding
);

const events: BannerEvent[] = [];
let previousBannerExitEndMs: number | null = null;

for (const candidate of candidates) {
  const faceZones: BoundingBox[] = manifest.face_zones ?? [];
  const templateId = "lower_third";
  const templateMeta = templateRegistry[templateId];

  const defaultOffset = -250;
  const resolvedOffset = resolveStartOffset(
    candidate.timecode_ms,
    defaultOffset,
    previousBannerExitEndMs
  );

  const startMs = candidate.timecode_ms + resolvedOffset;

  const baseStyle: BannerStyle = {
    theme: "default",
    opacity: 0.9,
    accent_colour: "#FFFFFF",
    border_radius: 8,
    shadow: true,
    shadow_blur: 4,
  };

  const scaleFactor = manifest.render_context?.scale_factor ?? 1.0;
  const scaledStyle = applyScaleFactor(baseStyle, scaleFactor);

  const proposedPosition: BannerPosition = {
    anchor: templateMeta.default_anchor,
    x: 0.02,
    y: 0.82,
    width: templateMeta.default_width,
    height: templateMeta.default_height,
  };

  const { position, suppressed, reason } = resolvePosition(
    proposedPosition,
    faceZones,
    proposedPosition.height
  );

  if (suppressed) {
    auditLog.record(
      manifest.job_id,
      candidate.timecode_ms,
      "SUPPRESSED",
      reason ?? "face_zone_unresolvable"
    );
    continue;
  }

  const duration = templateMeta.default_duration as number;
  const exitEndMs = startMs + duration * 1000;

  const bannerEvent: BannerEvent = {
    type: "motion_overlay",
    template: templateId,
    time: msToTimecode(startMs),
    duration,
    title: candidate.suggested_title,
    position,
    animation: {
      in: templateMeta.default_animation_in,
      hold: "static",
      out: templateMeta.default_animation_out,
      easing: templateMeta.default_easing,
    },
    style: {
      theme: scaledStyle.theme,
      opacity: scaledStyle.opacity,
      accent_colour: scaledStyle.accent_colour,
      border_radius: scaledStyle.border_radius,
      shadow: scaledStyle.shadow,
      ...(scaledStyle.shadow_blur !== undefined
        ? { shadow_blur: scaledStyle.shadow_blur }
        : {}),
    },
    layer: 1,
    user_editable: true,
    detection_source: candidate.detection_source,
    confidence: candidate.confidence,
    detection_profile: manifest.detection_profile,
    ...(manifest.render_context
      ? { render_context: manifest.render_context }
      : {}),
    ...(candidate.confidence < 0.6 ? { review_required: true } : {}),
  };

  const validated = BannerEventSchema.parse(bannerEvent);
  events.push(validated);
  previousBannerExitEndMs = exitEndMs;
}

const output = {
  job_id: manifest.job_id,
  generated_at: msToTimecode(0),
  events,
  audit_log: auditLog.toJSON(),
};

writeFileSync(values.out, JSON.stringify(output, null, 2), "utf-8");
console.log(`Wrote ${events.length} banner event(s) to ${values.out}`);
