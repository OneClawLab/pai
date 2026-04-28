/**
 * Image generation API client for OpenAI / Azure OpenAI endpoints.
 * Calls provider HTTP endpoints directly since pi-ai doesn't support image generation.
 */

import { PAIError, ExitCode } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImageClientConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  providerOptions?: Record<string, any>;
  /** The API type, e.g. 'azure-openai-responses' */
  api?: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  n?: number;
  size?: string;
  quality?: string;
  outputFormat?: string;
  background?: string;
}

export interface GeneratedImage {
  b64Json: string;
  revisedPrompt?: string | undefined;
}

export interface ImageGenerationResponse {
  created: number;
  images: GeneratedImage[];
}

// ---------------------------------------------------------------------------
// Provider default base URLs
// ---------------------------------------------------------------------------

const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com',
};

// ---------------------------------------------------------------------------
// ImageClient
// ---------------------------------------------------------------------------

export class ImageClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly isAzure: boolean;

  constructor(config: ImageClientConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    const apiType = config.api ?? config.provider;
    this.isAzure = apiType === 'azure-openai-responses' || apiType === 'azure-openai';
    this.endpoint = this.isAzure
      ? ImageClient.resolveAzureEndpoint(config.baseUrl, config.model, config.providerOptions)
      : ImageClient.resolveEndpoint(config.provider, config.baseUrl);
  }

  /**
   * Resolve the full image generation API endpoint URL (non-Azure).
   */
  static resolveEndpoint(provider: string, baseUrl?: string): string {
    const base =
      baseUrl ?? (Object.hasOwn(PROVIDER_DEFAULT_BASE_URLS, provider) ? PROVIDER_DEFAULT_BASE_URLS[provider] : undefined);
    if (!base) {
      throw new PAIError(
        `No base URL configured for provider "${provider}". Please specify a baseUrl.`,
        ExitCode.ARGUMENT_ERROR,
        { provider },
      );
    }
    return `${base.replace(/\/+$/, '')}/v1/images/generations`;
  }

  /**
   * Resolve the Azure OpenAI image generation endpoint URL.
   * Format: {baseUrl}/openai/deployments/{deployment}/images/generations?api-version={version}
   */
  static resolveAzureEndpoint(baseUrl?: string, model?: string, providerOptions?: Record<string, any>): string {
    if (!baseUrl) {
      throw new PAIError(
        'Azure OpenAI requires a baseUrl. Please specify a baseUrl.',
        ExitCode.ARGUMENT_ERROR,
      );
    }
    const deployment = model ?? providerOptions?.azureDeploymentName;
    if (!deployment) {
      throw new PAIError(
        'Azure OpenAI requires a deployment name. Specify a model or set providerOptions.azureDeploymentName.',
        ExitCode.ARGUMENT_ERROR,
      );
    }
    const apiVersion = providerOptions?.azureApiVersion as string | undefined;
    const resolvedVersion = (apiVersion && /^\d{4}-\d{2}-\d{2}/.test(apiVersion))
      ? apiVersion
      : '2025-04-01-preview';
    const resourceBase = baseUrl.replace(/\/openai\/v1\/?$/, '').replace(/\/+$/, '');
    return `${resourceBase}/openai/deployments/${deployment}/images/generations?api-version=${resolvedVersion}`;
  }

  /**
   * Call the image generation API.
   */
  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const body: Record<string, unknown> = {
      prompt: request.prompt,
    };
    // Only include model for non-Azure (Azure uses deployment in URL)
    if (!this.isAzure) {
      body.model = this.model;
    }
    if (request.n !== undefined) body.n = request.n;
    if (request.size !== undefined) body.size = request.size;
    if (request.quality !== undefined) body.quality = request.quality;
    if (request.outputFormat !== undefined) body.output_format = request.outputFormat;
    if (request.background !== undefined) body.background = request.background;

    let response: Response;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.isAzure) {
        headers['api-key'] = this.apiKey;
      } else {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new PAIError(
        `Network error calling image generation API: ${message}`,
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
        // ignore
      }
      throw new PAIError(
        `Image generation API error (${response.status}): ${detail || response.statusText}`,
        ExitCode.API_ERROR,
        { status: response.status, detail },
      );
    }

    const json = (await response.json()) as {
      created: number;
      data: { b64_json: string; revised_prompt?: string }[];
    };

    return {
      created: json.created,
      images: json.data.map((d) => ({
        b64Json: d.b64_json,
        revisedPrompt: d.revised_prompt,
      })),
    };
  }
}
