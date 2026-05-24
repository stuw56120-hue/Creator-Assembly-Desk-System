import type { TranscriptSegment, SemanticScore } from "../types.js";

export type EmbeddingFn = (text: string) => Promise<number[]>;

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have equal length for cosine similarity");
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

function getSegmentsInWindow(
  segments: TranscriptSegment[],
  startMs: number,
  endMs: number
): TranscriptSegment[] {
  return segments.filter(
    (s) => s.start_ms >= startMs && s.start_ms < endMs
  );
}

function windowText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join(" ").trim();
}

export async function computeSemanticScores(
  segments: TranscriptSegment[],
  windowSizeMs: number,
  windowOverlapMs: number,
  getEmbedding: EmbeddingFn
): Promise<SemanticScore[]> {
  if (segments.length === 0) return [];

  const startMs = segments[0].start_ms;
  const endMs = segments[segments.length - 1].end_ms;
  const stepMs = windowSizeMs - windowOverlapMs;

  if (stepMs <= 0) {
    throw new Error("window_overlap_ms must be less than window_size_ms");
  }

  const windowStarts: number[] = [];
  for (let t = startMs; t + windowSizeMs <= endMs; t += stepMs) {
    windowStarts.push(t);
  }

  if (windowStarts.length < 2) return [];

  const embeddings: (number[] | null)[] = await Promise.all(
    windowStarts.map(async (t) => {
      const windowSegs = getSegmentsInWindow(segments, t, t + windowSizeMs);
      const text = windowText(windowSegs);
      if (!text) return null;
      return getEmbedding(text);
    })
  );

  const scores: SemanticScore[] = [];
  for (let i = 1; i < windowStarts.length; i++) {
    const embA = embeddings[i - 1];
    const embB = embeddings[i];
    if (!embA || !embB) continue;

    const similarity = cosineSimilarity(embA, embB);
    const boundaryMs = windowStarts[i];
    scores.push({ boundary_ms: boundaryMs, similarity });
  }

  return scores;
}

export { cosineSimilarity };
