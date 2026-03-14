/**
 * Batch input parsing and embedding output formatting for the embed command.
 */

import { PAIError, ExitCode } from './types.js';
import type { EmbeddingResponse } from './embedding-client.js';

/**
 * Parse a raw string as a JSON string array for batch embedding.
 * Throws PAIError (exitCode 1) if the JSON is invalid or not an array of strings.
 * Returns an empty array if the input is an empty JSON array.
 */
export function parseBatchInput(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PAIError(
      'Invalid batch input: not valid JSON',
      ExitCode.PARAMETER_ERROR,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new PAIError(
      'Invalid batch input: expected a JSON array of strings',
      ExitCode.PARAMETER_ERROR,
    );
  }

  for (let i = 0; i < parsed.length; i++) {
    if (typeof parsed[i] !== 'string') {
      throw new PAIError(
        `Invalid batch input: element at index ${i} is not a string`,
        ExitCode.PARAMETER_ERROR,
      );
    }
  }

  return parsed as string[];
}

/**
 * Format an EmbeddingResponse for stdout output.
 *
 * Plain text mode (json=false):
 *   Single: one line with the embedding as a JSON array
 *   Batch:  one line per embedding, each as a JSON array
 *
 * JSON mode (json=true):
 *   Single: { "embedding": [...], "model": "...", "usage": { "prompt_tokens": N, "total_tokens": N } }
 *   Batch:  { "embeddings": [[...], ...], "model": "...", "usage": { "prompt_tokens": N, "total_tokens": N } }
 */
export function formatEmbeddingOutput(
  result: EmbeddingResponse,
  options: { json: boolean; batch: boolean },
): string {
  if (!options.json) {
    // Plain text: each embedding as a JSON array on its own line
    return result.embeddings
      .map((emb) => JSON.stringify(emb))
      .join('\n');
  }

  // JSON mode
  const usage = {
    prompt_tokens: result.usage.promptTokens,
    total_tokens: result.usage.totalTokens,
  };

  if (options.batch) {
    return JSON.stringify({
      embeddings: result.embeddings,
      model: result.model,
      usage,
    });
  }

  // Single mode – use "embedding" (singular) with the first vector
  return JSON.stringify({
    embedding: result.embeddings[0],
    model: result.model,
    usage,
  });
}
