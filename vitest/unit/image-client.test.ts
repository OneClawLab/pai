import { describe, it, expect, vi, afterEach } from 'vitest';
import { ImageClient } from '../../src/image-client.js';
import { PAIError, ExitCode } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(body: object, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response);
}

function makeImageResponse(count = 1) {
  return {
    created: 1698435368,
    data: Array.from({ length: count }, (_, i) => ({
      b64_json: Buffer.from(`fake-image-${i}`).toString('base64'),
      revised_prompt: `revised prompt ${i}`,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImageClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---- Endpoint resolution ----

  describe('resolveEndpoint', () => {
    it('should use baseUrl when provided', () => {
      const url = ImageClient.resolveEndpoint('openai', 'https://custom.example.com');
      expect(url).toBe('https://custom.example.com/v1/images/generations');
    });

    it('should strip trailing slash from baseUrl', () => {
      const url = ImageClient.resolveEndpoint('openai', 'https://custom.example.com/');
      expect(url).toBe('https://custom.example.com/v1/images/generations');
    });

    it('should use provider default for openai when no baseUrl', () => {
      const url = ImageClient.resolveEndpoint('openai');
      expect(url).toBe('https://api.openai.com/v1/images/generations');
    });

    it('should throw PAIError for unknown provider without baseUrl', () => {
      expect(() => ImageClient.resolveEndpoint('azure-openai')).toThrow(PAIError);
      try {
        ImageClient.resolveEndpoint('azure-openai');
      } catch (e) {
        expect(e).toBeInstanceOf(PAIError);
        expect((e as PAIError).exitCode).toBe(ExitCode.ARGUMENT_ERROR);
      }
    });

    it('should resolve edits endpoint when path is edits', () => {
      const url = ImageClient.resolveEndpoint('openai', undefined, 'edits');
      expect(url).toBe('https://api.openai.com/v1/images/edits');
    });
  });

  describe('resolveAzureEndpoint', () => {
    it('should build correct Azure endpoint with deployment and api version', () => {
      const url = ImageClient.resolveAzureEndpoint(
        'https://my-resource.openai.azure.com',
        'gpt-image-1',
        { azureApiVersion: '2025-04-01-preview' },
      );
      expect(url).toBe(
        'https://my-resource.openai.azure.com/openai/deployments/gpt-image-1/images/generations?api-version=2025-04-01-preview',
      );
    });

    it('should use model as deployment name over azureDeploymentName', () => {
      const url = ImageClient.resolveAzureEndpoint(
        'https://my-resource.openai.azure.com',
        'gpt-image-1',
        { azureDeploymentName: 'my-chat-deployment', azureApiVersion: '2025-04-01-preview' },
      );
      expect(url).toContain('/deployments/gpt-image-1/');
    });

    it('should fall back to azureDeploymentName when model is not provided', () => {
      const url = ImageClient.resolveAzureEndpoint(
        'https://my-resource.openai.azure.com',
        undefined,
        { azureDeploymentName: 'my-image-deployment', azureApiVersion: '2025-04-01-preview' },
      );
      expect(url).toContain('/deployments/my-image-deployment/');
    });

    it('should default api version when not provided', () => {
      const url = ImageClient.resolveAzureEndpoint(
        'https://my-resource.openai.azure.com',
        'gpt-image-1',
      );
      expect(url).toContain('api-version=2025-04-01-preview');
    });

    it('should strip /openai/v1 suffix from baseUrl', () => {
      const url = ImageClient.resolveAzureEndpoint(
        'https://my-resource.openai.azure.com/openai/v1',
        'gpt-image-1',
      );
      expect(url).toMatch(/^https:\/\/my-resource\.openai\.azure\.com\/openai\/deployments\//);
    });

    it('should throw when no baseUrl', () => {
      expect(() => ImageClient.resolveAzureEndpoint(undefined, 'gpt-image-1')).toThrow(PAIError);
    });

    it('should throw when no deployment name and no model', () => {
      expect(() => ImageClient.resolveAzureEndpoint('https://x.openai.azure.com', undefined)).toThrow(PAIError);
    });

    it('should resolve Azure edits endpoint when path is edits', () => {
      const url = ImageClient.resolveAzureEndpoint(
        'https://my-resource.openai.azure.com',
        'gpt-image-2',
        { azureApiVersion: '2025-04-01-preview' },
        'edits',
      );
      expect(url).toBe(
        'https://my-resource.openai.azure.com/openai/deployments/gpt-image-2/images/edits?api-version=2025-04-01-preview',
      );
    });
  });

  // ---- generate() success ----

  describe('generate – success', () => {
    it('should return generated images for a single image', async () => {
      const apiResponse = makeImageResponse(1);
      globalThis.fetch = mockFetchResponse(apiResponse);

      const client = new ImageClient({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-image-1',
      });

      const result = await client.generate({ prompt: 'a cat' });

      expect(result.created).toBe(1698435368);
      expect(result.images).toHaveLength(1);
      expect(result.images[0]!.b64Json).toBeTruthy();
      expect(result.images[0]!.revisedPrompt).toBe('revised prompt 0');
    });

    it('should return multiple images', async () => {
      const apiResponse = makeImageResponse(3);
      globalThis.fetch = mockFetchResponse(apiResponse);

      const client = new ImageClient({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-image-1',
      });

      const result = await client.generate({ prompt: 'abstract art', n: 3 });

      expect(result.images).toHaveLength(3);
    });

    it('should send correct request headers and body for OpenAI', async () => {
      const fetchMock = mockFetchResponse(makeImageResponse(1));
      globalThis.fetch = fetchMock;

      const client = new ImageClient({
        provider: 'openai',
        apiKey: 'sk-test-key',
        model: 'gpt-image-1',
      });

      await client.generate({
        prompt: 'hello',
        size: '1024x1024',
        quality: 'high',
        n: 1,
        outputFormat: 'png',
        background: 'auto',
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://api.openai.com/v1/images/generations');
      expect(options.method).toBe('POST');
      expect(options.headers['Authorization']).toBe('Bearer sk-test-key');
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.prompt).toBe('hello');
      expect(body.model).toBe('gpt-image-1');
      expect(body.size).toBe('1024x1024');
      expect(body.quality).toBe('high');
      expect(body.n).toBe(1);
      expect(body.output_format).toBe('png');
      expect(body.background).toBe('auto');
    });

    it('should send api-key header for Azure', async () => {
      const fetchMock = mockFetchResponse(makeImageResponse(1));
      globalThis.fetch = fetchMock;

      const client = new ImageClient({
        provider: 'azure-openai',
        apiKey: 'azure-key',
        model: 'gpt-image-1',
        api: 'azure-openai-responses',
        baseUrl: 'https://my-resource.openai.azure.com',
        providerOptions: { azureApiVersion: '2025-04-01-preview' },
      });

      await client.generate({ prompt: 'hello' });

      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toContain('my-resource.openai.azure.com');
      expect(url).toContain('/images/generations');
      expect(options.headers['api-key']).toBe('azure-key');
      expect(options.headers['Authorization']).toBeUndefined();

      // Azure should NOT include model in body
      const body = JSON.parse(options.body);
      expect(body.model).toBeUndefined();
    });

    it('should omit optional fields when not provided', async () => {
      const fetchMock = mockFetchResponse(makeImageResponse(1));
      globalThis.fetch = fetchMock;

      const client = new ImageClient({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-image-1',
      });

      await client.generate({ prompt: 'minimal' });

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
      expect(body.prompt).toBe('minimal');
      expect(body.model).toBe('gpt-image-1');
      // Optional fields should not be present
      expect(body.n).toBeUndefined();
      expect(body.size).toBeUndefined();
      expect(body.quality).toBeUndefined();
      expect(body.output_format).toBeUndefined();
      expect(body.background).toBeUndefined();
    });
  });

  // ---- generate() API errors ----

  describe('generate – API errors', () => {
    it('should throw PAIError with API_ERROR for 401', async () => {
      globalThis.fetch = mockFetchResponse({ error: { message: 'Invalid API key' } }, 401);

      const client = new ImageClient({
        provider: 'openai',
        apiKey: 'bad-key',
        model: 'gpt-image-1',
      });

      await expect(client.generate({ prompt: 'hi' })).rejects.toThrow(PAIError);

      try {
        await client.generate({ prompt: 'hi' });
      } catch (e) {
        expect(e).toBeInstanceOf(PAIError);
        expect((e as PAIError).exitCode).toBe(ExitCode.API_ERROR);
        expect((e as PAIError).message).toContain('401');
      }
    });

    it('should throw PAIError with API_ERROR for 400 content filter', async () => {
      globalThis.fetch = mockFetchResponse(
        { error: { code: 'contentFilter', message: 'Your task failed as a result of our safety system.' } },
        400,
      );

      const client = new ImageClient({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-image-1',
      });

      try {
        await client.generate({ prompt: 'bad content' });
      } catch (e) {
        expect(e).toBeInstanceOf(PAIError);
        expect((e as PAIError).exitCode).toBe(ExitCode.API_ERROR);
        expect((e as PAIError).context?.status).toBe(400);
      }
    });

    it('should throw PAIError with API_ERROR for 429 rate limit', async () => {
      globalThis.fetch = mockFetchResponse({ error: { message: 'Rate limit exceeded' } }, 429);

      const client = new ImageClient({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-image-1',
      });

      try {
        await client.generate({ prompt: 'hi' });
      } catch (e) {
        expect(e).toBeInstanceOf(PAIError);
        expect((e as PAIError).exitCode).toBe(ExitCode.API_ERROR);
      }
    });
  });

  // ---- generate() network errors ----

  describe('generate – network errors', () => {
    it('should throw PAIError with RUNTIME_ERROR on fetch failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

      const client = new ImageClient({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-image-1',
      });

      try {
        await client.generate({ prompt: 'hi' });
      } catch (e) {
        expect(e).toBeInstanceOf(PAIError);
        expect((e as PAIError).exitCode).toBe(ExitCode.RUNTIME_ERROR);
        expect((e as PAIError).message).toContain('Network error');
      }
    });

    it('should throw PAIError with RUNTIME_ERROR on connection refused', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const client = new ImageClient({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-image-1',
        baseUrl: 'http://localhost:9999',
      });

      try {
        await client.generate({ prompt: 'hi' });
      } catch (e) {
        expect(e).toBeInstanceOf(PAIError);
        expect((e as PAIError).exitCode).toBe(ExitCode.RUNTIME_ERROR);
        expect((e as PAIError).message).toContain('ECONNREFUSED');
      }
    });
  });

  // ---- custom baseUrl ----

  describe('custom baseUrl', () => {
    it('should call the custom endpoint', async () => {
      const fetchMock = mockFetchResponse(makeImageResponse(1));
      globalThis.fetch = fetchMock;

      const client = new ImageClient({
        provider: 'custom',
        apiKey: 'sk-custom',
        model: 'my-model',
        baseUrl: 'https://my-proxy.example.com',
      });

      await client.generate({ prompt: 'test' });

      const [url] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://my-proxy.example.com/v1/images/generations');
    });
  });

  // ---- edit() ----

  describe('edit', () => {
    it('should call the edits endpoint with multipart form data', async () => {
      const fetchMock = mockFetchResponse(makeImageResponse(1));
      globalThis.fetch = fetchMock;

      // Create a temp image file for the test
      const { writeFileSync, unlinkSync } = await import('node:fs');
      const tmpPath = 'vitest_tmp_test_image.png';
      writeFileSync(tmpPath, Buffer.from('fake-png-data'));

      try {
        const client = new ImageClient({
          provider: 'openai',
          apiKey: 'sk-test',
          model: 'gpt-image-2',
        });

        const result = await client.edit({
          prompt: 'add a hat',
          images: [tmpPath],
          n: 1,
          size: '1024x1024',
          quality: 'high',
        });

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, options] = fetchMock.mock.calls[0]!;
        expect(url).toBe('https://api.openai.com/v1/images/edits');
        expect(options.method).toBe('POST');
        expect(options.headers['Authorization']).toBe('Bearer sk-test');
        // Content-Type should NOT be set (fetch sets it for FormData)
        expect(options.headers['Content-Type']).toBeUndefined();
        // Body should be FormData
        expect(options.body).toBeInstanceOf(FormData);

        expect(result.images).toHaveLength(1);
        expect(result.created).toBe(1698435368);
      } finally {
        unlinkSync(tmpPath);
      }
    });

    it('should use Azure edits endpoint with api-key header', async () => {
      const fetchMock = mockFetchResponse(makeImageResponse(1));
      globalThis.fetch = fetchMock;

      const { writeFileSync, unlinkSync } = await import('node:fs');
      const tmpPath = 'vitest_tmp_test_image2.png';
      writeFileSync(tmpPath, Buffer.from('fake-png-data'));

      try {
        const client = new ImageClient({
          provider: 'azure-openai',
          apiKey: 'azure-key',
          model: 'gpt-image-2',
          api: 'azure-openai-responses',
          baseUrl: 'https://my-resource.openai.azure.com',
          providerOptions: { azureApiVersion: '2025-04-01-preview' },
        });

        await client.edit({
          prompt: 'add a hat',
          images: [tmpPath],
        });

        const [url, options] = fetchMock.mock.calls[0]!;
        expect(url).toContain('/images/edits');
        expect(url).toContain('my-resource.openai.azure.com');
        expect(options.headers['api-key']).toBe('azure-key');
        expect(options.headers['Authorization']).toBeUndefined();
      } finally {
        unlinkSync(tmpPath);
      }
    });

    it('should throw PAIError on API error', async () => {
      globalThis.fetch = mockFetchResponse({ error: { message: 'Bad request' } }, 400);

      const { writeFileSync, unlinkSync } = await import('node:fs');
      const tmpPath = 'vitest_tmp_test_image3.png';
      writeFileSync(tmpPath, Buffer.from('fake-png-data'));

      try {
        const client = new ImageClient({
          provider: 'openai',
          apiKey: 'sk-test',
          model: 'gpt-image-2',
        });

        await expect(client.edit({
          prompt: 'edit this',
          images: [tmpPath],
        })).rejects.toThrow(PAIError);
      } finally {
        unlinkSync(tmpPath);
      }
    });
  });
});
