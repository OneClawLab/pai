/**
 * Embedding API client for OpenAI-compatible endpoints.
 * Calls provider HTTP endpoints directly since pi-ai doesn't support embeddings.
 */

import { PAIError, ExitCode } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingRequest {
  texts: string[];
  model: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

export interface EmbeddingClientConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Provider default base URLs
// ---------------------------------------------------------------------------

const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com',
};

// ---------------------------------------------------------------------------
// EmbeddingClient
// ---------------------------------------------------------------------------

export class EmbeddingClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: EmbeddingClientConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.endpoint = EmbeddingClient.resolveEndpoint(config.provider, config.baseUrl);
  }

  /**
   * Resolve the full embeddings API endpoint URL.
   * If baseUrl is provided, use it; otherwise fall back to the provider default.
   */
  static resolveEndpoint(provider: string, baseUrl?: string): string {
    const base =
      baseUrl ?? (Object.hasOwn(PROVIDER_DEFAULT_BASE_URLS, provider) ? PROVIDER_DEFAULT_BASE_URLS[provider] : undefined);
    if (!base) {
      throw new PAIError(
        `No base URL configured for provider "${provider}". Please specify a baseUrl.`,
        ExitCode.PARAMETER_ERROR,
        { provider },
      );
    }
    // Strip trailing slash before appending path
    return `${base.replace(/\/+$/, '')}/v1/embeddings`;
  }

  /**
   * Call the embedding API for the given texts.
   */
  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const body = JSON.stringify({
      model: request.model,
      input: request.texts,
    });

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body,
      });
    } catch (err: unknown) {
      // Network-level errors (timeout, DNS, connection refused, etc.)
      const message = err instanceof Error ? err.message : String(err);
      throw new PAIError(
        `Network error calling embedding API: ${message}`,
        ExitCode.RUNTIME_ERROR,
        { endpoint: this.endpoint, cause: message },
      );
    }

    if (!response.ok) {
      let detail = '';
      try {
        const errorBody = await response.text();
        detail = errorBody;
      } catch {
        // ignore – we already have the status code
      }
      throw new PAIError(
        `Embedding API error (${response.status}): ${detail || response.statusText}`,
        ExitCode.API_ERROR,
        { status: response.status, detail },
      );
    }

    // Parse successful response (OpenAI-compatible format)
    const json = (await response.json()) as {
      data: { embedding: number[]; index: number }[];
      model: string;
      usage: { prompt_tokens: number; total_tokens: number };
    };

    // Sort by index to guarantee order matches input order
    const sorted = [...json.data].sort((a, b) => a.index - b.index);

    return {
      embeddings: sorted.map((d) => d.embedding),
      model: json.model,
      usage: {
        promptTokens: json.usage.prompt_tokens,
        totalTokens: json.usage.total_tokens,
      },
    };
  }
}
