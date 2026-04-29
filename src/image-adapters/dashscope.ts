import type { ImageClientConfig, ImageGenerationRequest, ImageGenerationResponse, GeneratedImage } from '../image-client.js';
import { PAIError, ExitCode } from '../types.js';

function normalizeSize(size?: string): string | undefined {
  if (!size) return undefined;
  // Accept formats like 2048*2048, 2048x2048, 2048×2048 -> normalize to 2048*2048
  const s = size.replace(/×/g, '*').replace(/x/gi, '*');
  const parts = s.split('*').map((p) => p.trim());
  if (parts.length === 2 && parts[0] && parts[1]) {
    return `${parts[0]}*${parts[1]}`;
  }
  return size;
}

async function fetchImageAsBase64(url: string, apiKey?: string): Promise<string> {
  try {
    const headers: Record<string, string> = {};
    // If the image URL requires the same bearer (unlikely), allow passing apiKey
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      throw new Error(`Failed to fetch image URL: ${resp.status} ${resp.statusText}`);
    }
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab).toString('base64');
  } catch (err: unknown) {
    throw new PAIError(
      err instanceof Error ? err.message : String(err),
      ExitCode.API_ERROR,
      { url }
    );
  }
}

export async function dashscopeGenerate(
  config: ImageClientConfig,
  request: ImageGenerationRequest,
): Promise<ImageGenerationResponse> {
  const baseUrl = config.baseUrl ?? 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
  const model = config.model ?? 'qwen-image-2.0-pro';
  const apiKey = config.apiKey;

  // Build content array: only support text->image (文生图). Images in content are allowed as URLs only,
  // but per decision we do NOT auto-upload local files. The CLI will pass only prompt for text generation.
  const content: Array<Record<string, string>> = [];
  // If request has any image-like fields we ignore here (text-only mode)
  content.push({ text: request.prompt });

  const body: Record<string, any> = {
    model,
    input: {
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    },
    parameters: {
      n: request.n ?? 1,
      negative_prompt: '',
      watermark: false,
    },
  };

  const size = normalizeSize(request.size);
  if (size) body.parameters.size = size;

  const maxRetries = 2;
  let attempt = 0;
  let lastErr: unknown = null;

  while (attempt <= maxRetries) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const resp = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        // Retry on 429/5xx
        if ((resp.status === 429 || resp.status >= 500) && attempt < maxRetries) {
          attempt++;
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
          continue;
        }
        throw new PAIError(
          `Dashscope API error (${resp.status}): ${txt || resp.statusText}`,
          ExitCode.API_ERROR,
          { status: resp.status, detail: txt },
        );
      }

      const json = await resp.json().catch(() => null);
      if (!json) {
        throw new PAIError('Empty response from Dashscope', ExitCode.API_ERROR);
      }

      // Attempt to find images in common fields
      let images: string[] = [];
      // Dashscope often returns images under output.choices[].message.content[]
      // where content is an array of { image: <url> } / { text: ... } entries.
      if (json.output && Array.isArray(json.output.choices)) {
        for (const choice of json.output.choices) {
          const msg = choice?.message;
          const content = msg?.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (typeof c === 'string') continue;
              if (c?.image) images.push(c.image as string);
              else if (c?.url) images.push(c.url as string);
              else if (c?.b64) images.push(c.b64 as string);
              else if (c?.b64_json) images.push(c.b64_json as string);
            }
          }
        }
      }
      // Common candidate paths
      if (Array.isArray(json.output_images)) images = json.output_images as string[];
      else if (Array.isArray(json.data?.output_images)) images = json.data.output_images as string[];
      else if (Array.isArray(json.data?.images)) images = json.data.images as string[];
      else if (Array.isArray(json.images)) images = json.images as string[];
      else if (Array.isArray(json.data)) {
        // sometimes data is array of objects
        for (const item of json.data) {
          if (typeof item === 'string') images.push(item);
          else if (item?.url) images.push(item.url);
          else if (item?.b64) images.push(item.b64);
          else if (item?.b64_json) images.push(item.b64_json);
        }
      }

      // If still empty, try nested "output" or "result"
      if (images.length === 0 && json.output) {
        if (Array.isArray(json.output)) images = json.output.map((x: any) => x.url ?? x.b64 ?? x);
        else if (json.output?.images) images = json.output.images.map((x: any) => x.url ?? x.b64 ?? x);
      }

      // Normalize each image into base64
      const resultImages: GeneratedImage[] = [];
      for (const img of images) {
        if (!img) continue;
        if (typeof img === 'string') {
          // data URL
          if (/^data:/.test(img)) {
            const m = img.match(/^data:[^;]+;base64,(.*)$/);
            if (m && m[1]) {
              resultImages.push({ b64Json: m[1] });
            } else {
              // not base64 data URL, attempt to fetch
              const b64 = await fetchImageAsBase64(img, apiKey);
              resultImages.push({ b64Json: b64 });
            }
          } else if (/^[A-Za-z0-9+/=\s]+$/.test(img) && img.length > 100) {
            // Looks like raw base64
            resultImages.push({ b64Json: img.replace(/\s+/g, '') });
          } else if (/^https?:\/\//.test(img)) {
            const b64 = await fetchImageAsBase64(img, apiKey);
            resultImages.push({ b64Json: b64 });
          } else {
            // Unknown string, attempt fetch
            const b64 = await fetchImageAsBase64(img, apiKey);
            resultImages.push({ b64Json: b64 });
          }
        }
      }

      if (resultImages.length === 0) {
        // No images extracted — include short diagnostic to help debugging
        const short = JSON.stringify(json).slice(0, 1000);
        throw new PAIError(
          'Dashscope returned no images in the response',
          ExitCode.API_ERROR,
          { keys: Object.keys(json || {}), snippet: short },
        );
      }

      return {
        created: Date.now(),
        images: resultImages,
      };
    } catch (err) {
      lastErr = err;
      attempt++;
      if (attempt > maxRetries) break;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }

  if (lastErr instanceof PAIError) throw lastErr;
  throw new PAIError(
    lastErr instanceof Error ? lastErr.message : String(lastErr),
    ExitCode.API_ERROR,
  );
}
