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

export interface ImageEditRequest {
  prompt: string;
  images: string[];
  mask?: string | undefined;
  n?: number;
  size?: string;
  quality?: string;
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
  dashscope: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
};

// ---------------------------------------------------------------------------
// ImageClient
// ---------------------------------------------------------------------------

export class ImageClient {
  private readonly generationEndpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly isAzure: boolean;
  private readonly config: ImageClientConfig;

  constructor(config: ImageClientConfig) {
    this.config = config;
    this.apiKey = config.apiKey;
    this.model = config.model;
    const apiType = config.api ?? config.provider;
    this.isAzure = apiType === 'azure-openai-responses' || apiType === 'azure-openai';
    this.generationEndpoint = this.isAzure
      ? ImageClient.resolveAzureEndpoint(config.baseUrl, config.model, config.providerOptions)
      : ImageClient.resolveEndpoint(config.provider, config.baseUrl);
  }

  /**
   * Resolve the full image generation API endpoint URL (non-Azure).
   */
  static resolveEndpoint(provider: string, baseUrl?: string, path = 'generations'): string {
    const base =
      baseUrl ?? (Object.hasOwn(PROVIDER_DEFAULT_BASE_URLS, provider) ? PROVIDER_DEFAULT_BASE_URLS[provider] : undefined);
    if (!base) {
      throw new PAIError(
        `No base URL configured for provider "${provider}". Please specify a baseUrl.`,
        ExitCode.ARGUMENT_ERROR,
        { provider },
      );
    }
    return `${base.replace(/\/+$/, '')}/v1/images/${path}`;
  }

  /**
   * Resolve the Azure OpenAI image generation endpoint URL.
   * Format: {baseUrl}/openai/deployments/{deployment}/images/generations?api-version={version}
   */
  static resolveAzureEndpoint(baseUrl?: string, model?: string, providerOptions?: Record<string, any>, path = 'generations'): string {
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
    return `${resourceBase}/openai/deployments/${deployment}/images/${path}?api-version=${resolvedVersion}`;
  }

  /**
   * Call the image generation API.
   */
  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    // Special-case Dashscope (aliyun dashscope / 百炼) provider which uses
    // a different endpoint and request/response shape.
    if (this.config.provider === 'dashscope') {
      const { dashscopeGenerate } = await import('./image-adapters/dashscope.js');
      return await dashscopeGenerate(this.config, request);
    }

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

      response = await fetch(this.generationEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new PAIError(
        `Network error calling image generation API: ${message}`,
        ExitCode.RUNTIME_ERROR,
        { endpoint: this.generationEndpoint, cause: message },
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

  /**
   * Call the image edit API (multipart/form-data).
   * Uses /images/edits endpoint with image file uploads.
   */
  async edit(request: ImageEditRequest): Promise<ImageGenerationResponse> {
    const editEndpoint = this.isAzure
      ? ImageClient.resolveAzureEndpoint(this.config.baseUrl, this.model, this.config.providerOptions, 'edits')
      : ImageClient.resolveEndpoint(this.config.provider, this.config.baseUrl, 'edits');

    const formData = new FormData();
    formData.append('prompt', request.prompt);

    // Append image files — API expects image[] for multiple images
    for (const imagePath of request.images) {
      const { readFile: readFileAsync } = await import('node:fs/promises');
      const buffer = await readFileAsync(imagePath);
      const ext = imagePath.toLowerCase().split('.').pop();
      let mimeType = 'image/png';
      if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
      else if (ext === 'webp') mimeType = 'image/webp';
      const fileName = imagePath.split(/[/\\]/).pop() ?? 'image.png';
      const blob = new Blob([buffer], { type: mimeType });
      formData.append('image[]', blob, fileName);
    }

    // Append optional mask
    if (request.mask) {
      const { readFile: readFileAsync } = await import('node:fs/promises');
      const buffer = await readFileAsync(request.mask);
      const blob = new Blob([buffer], { type: 'image/png' });
      const fileName = request.mask.split(/[/\\]/).pop() ?? 'mask.png';
      formData.append('mask', blob, fileName);
    }

    // Only include model for non-Azure
    if (!this.isAzure) {
      formData.append('model', this.model);
    }
    if (request.n !== undefined) formData.append('n', String(request.n));
    if (request.size !== undefined) formData.append('size', request.size);
    if (request.quality !== undefined) formData.append('quality', request.quality);

    let response: Response;
    try {
      const headers: Record<string, string> = {};
      // Do NOT set Content-Type — fetch sets it automatically with boundary for FormData
      if (this.isAzure) {
        headers['api-key'] = this.apiKey;
      } else {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      response = await fetch(editEndpoint, {
        method: 'POST',
        headers,
        body: formData,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new PAIError(
        `Network error calling image edit API: ${message}`,
        ExitCode.RUNTIME_ERROR,
        { endpoint: editEndpoint, cause: message },
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
        `Image edit API error (${response.status}): ${detail || response.statusText}`,
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
