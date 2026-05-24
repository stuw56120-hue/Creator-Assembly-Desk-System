import { z } from "zod";

const TranscriptSegmentSchema = z.object({
  start_ms: z.number().min(0),
  end_ms: z.number().positive(),
  text: z.string(),
  speaker_id: z.string(),
});

const BoundingBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
});

const DetectionThresholdsSchema = z.object({
  window_size_ms: z.number().positive().optional(),
  window_overlap_ms: z.number().min(0).optional(),
  min_topic_duration_ms: z.number().positive().optional(),
  major_similarity_threshold: z.number().min(0).max(1).optional(),
  minor_similarity_threshold: z.number().min(0).max(1).optional(),
  silence_boost_threshold_ms: z.number().positive().optional(),
  speaker_weight: z.number().positive().optional(),
});

export const JobManifestSchema = z.object({
  job_id: z.string().min(1),
  transcript: z.array(TranscriptSegmentSchema).min(1),
  detection_profile: z.enum(["podcast", "sports", "documentary", "interview"]),
  face_zones: z.array(BoundingBoxSchema).optional(),
  render_context: z
    .object({
      resolution: z.enum(["1080p", "4k", "vertical"]),
      scale_factor: z.number().positive(),
    })
    .optional(),
  threshold_overrides: DetectionThresholdsSchema.optional(),
});

export type JobManifest = z.infer<typeof JobManifestSchema>;
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;
export type DetectionThresholds = z.infer<typeof DetectionThresholdsSchema>;
