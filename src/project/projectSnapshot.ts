/*
 * Project snapshot (mid-edit save/reopen).
 *
 * Serializes the editor state — project metadata, the full timeline (with the
 * user's toggles/moves/resolved reviews), keep segments, and approval — to a
 * plain object written as cads-project.json. Reopening validates it with Zod
 * and surfaces plain-English errors rather than throwing.
 */

import { z } from "zod";
import type { KeepSegment, TimelineEvent } from "./types";

export const SNAPSHOT_VERSION = 1;

const KeepSegmentSchema = z.object({ start: z.number(), end: z.number() });

const TimelineEventSchema = z
  .object({
    id: z.string(),
    kind: z.enum([
      "cut",
      "chapter",
      "caption",
      "motion_graphic",
      "image",
      "meme",
      "short_in",
      "short_out",
      "transition",
    ]),
    label: z.string(),
    start: z.number(),
    duration: z.number(),
    track: z.number(),
    enabled: z.boolean(),
    locked: z.boolean(),
    reviewRequired: z.boolean(),
    confidence: z.number(),
  })
  .passthrough(); // keep cutData / overlayData / motionGraphicData / etc.

export const ProjectSnapshotSchema = z.object({
  version: z.number(),
  projectName: z.string(),
  durationSeconds: z.number().nonnegative(),
  sourceVideoPath: z.string(),
  approved: z.boolean(),
  events: z.array(TimelineEventSchema),
  keepSegments: z.array(KeepSegmentSchema),
  playerDisplayNames: z.record(z.string()).default({}),
});

export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;

export interface SerializableProject {
  projectName: string;
  durationSeconds: number;
  sourceVideoPath: string;
  approved: boolean;
  events: TimelineEvent[];
  keepSegments: KeepSegment[];
  playerDisplayNames: Record<string, string>;
}

export function serializeProject(state: SerializableProject): ProjectSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    projectName: state.projectName,
    durationSeconds: state.durationSeconds,
    sourceVideoPath: state.sourceVideoPath,
    approved: state.approved,
    // TimelineEvent has no index signature; the schema's passthrough type does.
    events: state.events as ProjectSnapshot["events"],
    keepSegments: state.keepSegments,
    playerDisplayNames: state.playerDisplayNames,
  };
}

export type DeserializeResult =
  | { ok: true; snapshot: ProjectSnapshot }
  | { ok: false; errors: string[] };

/** Validate a parsed cads-project.json object. */
export function deserializeProject(raw: unknown): DeserializeResult {
  const parsed = ProjectSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  if (parsed.data.version > SNAPSHOT_VERSION) {
    return {
      ok: false,
      errors: [
        `This project was saved by a newer version of C.A.D.S. (v${parsed.data.version}). Please update.`,
      ],
    };
  }
  return { ok: true, snapshot: parsed.data };
}
