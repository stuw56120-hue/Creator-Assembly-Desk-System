export interface TranscriptSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  speaker_id: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AnchorPoint =
  | "top_left"
  | "top_center"
  | "top_right"
  | "center_left"
  | "center"
  | "center_right"
  | "bottom_left"
  | "bottom_center"
  | "bottom_right";

export type AnimationType =
  | "fade"
  | "slide_up"
  | "slide_down"
  | "slide_left"
  | "slide_right"
  | "wipe_right"
  | "wipe_left"
  | "scale";

export type EasingType =
  | "linear"
  | "ease_in"
  | "ease_out"
  | "ease_in_out"
  | "bounce";

export type BannerTemplate =
  | "lower_third"
  | "title_card"
  | "corner_badge"
  | "full_width_bar";

export type DetectionSource =
  | "semantic_similarity"
  | "silence_gap"
  | "gpt_editorial"
  | "speaker_transition";

export type DetectionProfileName =
  | "podcast"
  | "sports"
  | "documentary"
  | "interview";

export interface DetectionThresholds {
  window_size_ms: number;
  window_overlap_ms: number;
  min_topic_duration_ms: number;
  major_similarity_threshold: number;
  minor_similarity_threshold: number;
  silence_boost_threshold_ms: number;
  speaker_weight: number;
}

export interface BannerPosition {
  anchor: AnchorPoint;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BannerStyle {
  theme: string;
  opacity: number;
  accent_colour: string;
  border_radius: number;
  shadow: boolean;
  shadow_blur?: number;
}

export interface CandidateTransition {
  timecode_ms: number;
  semantic_score: number;
  silence_score: number;
  speaker_score: number;
  gpt_score: number;
  confidence: number;
  detection_source: DetectionSource;
  suggested_title: string;
  suggested_subtitle?: string;
}

export interface SilenceCandidate {
  timecode_ms: number;
  gap_ms: number;
}

export interface SpeakerCandidate {
  timecode_ms: number;
  from_speaker: string;
  to_speaker: string;
  weighted_confidence: number;
}

export interface SemanticScore {
  boundary_ms: number;
  similarity: number;
}

export interface GptEditorialResult {
  is_topic_change: boolean;
  confidence: number;
  suggested_title: string;
  rationale: string;
}

export interface AuditEntry {
  job_id: string;
  timecode: string;
  state: string;
  reason: string;
  timestamp: string;
}

export type Resolution = "1080p" | "4k" | "vertical";
