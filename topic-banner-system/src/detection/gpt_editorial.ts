import type { TranscriptSegment, GptEditorialResult } from "../types.js";

export interface GptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GptResponse {
  choices: Array<{
    message: { content: string };
  }>;
}

export type GptClientFn = (messages: GptMessage[]) => Promise<GptResponse>;

const SYSTEM_PROMPT = `You are a video editing assistant that detects topic changes in transcripts.
Analyse the provided transcript window and determine if it contains a topic change.
Respond ONLY with valid JSON matching this schema:
{
  "is_topic_change": boolean,
  "confidence": number (0.0-1.0),
  "suggested_title": string,
  "rationale": string
}`;

export async function analyseWithGpt(
  segments: TranscriptSegment[],
  gptClient: GptClientFn
): Promise<GptEditorialResult> {
  const text = segments.map((s) => `[${s.speaker_id}]: ${s.text}`).join("\n");

  const messages: GptMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Analyse this transcript window for topic changes:\n\n${text}`,
    },
  ];

  const response = await gptClient(messages);
  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error("Empty response from GPT client");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON from GPT: ${content}`);
  }

  const result = parsed as GptEditorialResult;

  if (
    typeof result.is_topic_change !== "boolean" ||
    typeof result.confidence !== "number" ||
    typeof result.suggested_title !== "string" ||
    typeof result.rationale !== "string"
  ) {
    throw new Error(`Unexpected GPT response shape: ${content}`);
  }

  return result;
}
