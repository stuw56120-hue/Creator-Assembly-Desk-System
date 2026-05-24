import type { TranscriptSegment, DetectionThresholds, CandidateTransition, DetectionSource } from "../types.js";
import { detectSilenceGaps } from "./silence.js";
import { detectSpeakerTransitions } from "./speaker.js";
import { computeSemanticScores, type EmbeddingFn } from "./semantic.js";
import { analyseWithGpt, type GptClientFn } from "./gpt_editorial.js";

const SEMANTIC_WEIGHT = 0.4;
const SILENCE_WEIGHT = 0.2;
const SPEAKER_WEIGHT = 0.2;
const GPT_WEIGHT = 0.2;

function msToTimecode(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const millis = ms % 1000;
  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0"),
  ].join(":") + "." + String(millis).padStart(3, "0");
}

function getSegmentsInWindow(
  segments: TranscriptSegment[],
  startMs: number,
  endMs: number
): TranscriptSegment[] {
  return segments.filter((s) => s.start_ms >= startMs && s.start_ms < endMs);
}

function isNearThreshold(
  similarity: number,
  threshold: number,
  band = 0.15
): boolean {
  return Math.abs(similarity - threshold) <= band;
}

export async function runDetectionPipeline(
  segments: TranscriptSegment[],
  profile: DetectionThresholds,
  getEmbedding: EmbeddingFn,
  gptClient?: GptClientFn
): Promise<CandidateTransition[]> {
  const [semanticScores, silenceCandidates, speakerCandidates] =
    await Promise.all([
      computeSemanticScores(
        segments,
        profile.window_size_ms,
        profile.window_overlap_ms,
        getEmbedding
      ),
      Promise.resolve(
        detectSilenceGaps(segments, profile.silence_boost_threshold_ms)
      ),
      Promise.resolve(
        detectSpeakerTransitions(segments, profile.speaker_weight)
      ),
    ]);

  const silenceByTime = new Map(
    silenceCandidates.map((s) => [s.timecode_ms, s])
  );
  const speakerByTime = new Map(
    speakerCandidates.map((s) => [s.timecode_ms, s])
  );

  const candidates: CandidateTransition[] = [];

  for (const score of semanticScores) {
    const boundaryMs = score.boundary_ms;

    // Dissimilarity: low cosine similarity between windows signals a topic shift.
    const semanticScore = Math.max(0, 1 - score.similarity);

    const nearTolerance = profile.window_size_ms / 2;

    const silenceNear = findNearest(silenceByTime, boundaryMs, nearTolerance);
    const silenceScore = silenceNear
      ? Math.min(1.0, silenceNear.gap_ms / (profile.silence_boost_threshold_ms * 2))
      : 0;

    const speakerNear = findNearest(speakerByTime, boundaryMs, nearTolerance);
    const speakerScore = speakerNear ? speakerNear.weighted_confidence : 0;

    let gptScore = 0;
    let suggestedTitle = "";

    if (
      gptClient &&
      isNearThreshold(semanticScore, profile.major_similarity_threshold)
    ) {
      const windowSegs = getSegmentsInWindow(
        segments,
        boundaryMs - profile.window_size_ms / 2,
        boundaryMs + profile.window_size_ms / 2
      );
      if (windowSegs.length > 0) {
        try {
          const result = await analyseWithGpt(windowSegs, gptClient);
          gptScore = result.is_topic_change ? result.confidence : 0;
          suggestedTitle = result.suggested_title;
        } catch {
          gptScore = 0;
        }
      }
    }

    const confidence =
      SEMANTIC_WEIGHT * semanticScore +
      SILENCE_WEIGHT * silenceScore +
      SPEAKER_WEIGHT * speakerScore +
      GPT_WEIGHT * gptScore;

    const dominantSource = pickDominantSource(
      semanticScore * SEMANTIC_WEIGHT,
      silenceScore * SILENCE_WEIGHT,
      speakerScore * SPEAKER_WEIGHT,
      gptScore * GPT_WEIGHT
    );

    candidates.push({
      timecode_ms: boundaryMs,
      semantic_score: semanticScore,
      silence_score: silenceScore,
      speaker_score: speakerScore,
      gpt_score: gptScore,
      confidence,
      detection_source: dominantSource,
      suggested_title: suggestedTitle || deriveTitle(segments, boundaryMs),
    });
  }

  return candidates.filter(
    (c) => c.confidence >= profile.major_similarity_threshold
  );
}

function findNearest<T extends { timecode_ms: number }>(
  map: Map<number, T>,
  targetMs: number,
  toleranceMs: number
): T | undefined {
  let best: T | undefined;
  let bestDist = Infinity;
  for (const [t, val] of map) {
    const dist = Math.abs(t - targetMs);
    if (dist <= toleranceMs && dist < bestDist) {
      best = val;
      bestDist = dist;
    }
  }
  return best;
}

function pickDominantSource(
  s: number,
  sil: number,
  sp: number,
  gpt: number
): DetectionSource {
  const scores: [number, DetectionSource][] = [
    [s, "semantic_similarity"],
    [sil, "silence_gap"],
    [sp, "speaker_transition"],
    [gpt, "gpt_editorial"],
  ];
  scores.sort((a, b) => b[0] - a[0]);
  return scores[0][1];
}

function deriveTitle(segments: TranscriptSegment[], boundaryMs: number): string {
  const after = segments.find((s) => s.start_ms >= boundaryMs);
  if (!after) return "New Topic";
  const words = after.text.split(/\s+/).slice(0, 5).join(" ");
  return words || "New Topic";
}

export { msToTimecode };
