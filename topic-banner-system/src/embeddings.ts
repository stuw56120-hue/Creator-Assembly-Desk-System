import OpenAI from "openai";
import type { EmbeddingFn } from "./detection/semantic.js";

export function createOpenAIEmbeddingFn(
  apiKey: string,
  model = "text-embedding-3-small"
): EmbeddingFn {
  const client = new OpenAI({ apiKey });

  return async (text: string): Promise<number[]> => {
    const response = await client.embeddings.create({
      model,
      input: text,
      encoding_format: "float",
    });
    return response.data[0].embedding;
  };
}

export function createMockEmbeddingFn(): EmbeddingFn {
  return async (text: string): Promise<number[]> => {
    const bytes = Buffer.from(text.slice(0, 64));
    return Array.from({ length: 1536 }, (_, i) => (bytes[i % bytes.length] ?? 0) / 255);
  };
}
