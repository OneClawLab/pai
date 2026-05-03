import { writeFile } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import type { ImageOptions } from '../types.js';
import { PAIError, ExitCode } from '../types.js';
import { ConfigurationManager } from '../config-manager.js';
import { InputResolver } from '../input-resolver.js';
import { OutputFormatter } from '../output-formatter.js';
import { ImageClient } from '../image-client.js';
import { resolveImageModel } from '../image-model-resolver.js';

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

const PRESET_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024', 'auto']);
const VALID_QUALITIES = new Set(['low', 'medium', 'high', 'auto']);

// gpt-image-2 constraints for custom sizes
const MAX_EDGE = 3840;
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;
const MAX_ASPECT_RATIO = 3;
const EDGE_MULTIPLE = 16;

function validateSize(size: string): string | null {
  if (PRESET_SIZES.has(size)) return null;
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return `Invalid size format: ${size}. Use WxH (e.g. 3840x2160) or one of: ${[...PRESET_SIZES].join(', ')}`;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (w % EDGE_MULTIPLE !== 0 || h % EDGE_MULTIPLE !== 0) return `Both dimensions must be multiples of ${EDGE_MULTIPLE}. Got ${w}x${h}`;
  if (w > MAX_EDGE || h > MAX_EDGE) return `Each dimension must be <= ${MAX_EDGE}px. Got ${w}x${h}`;
  if (w < EDGE_MULTIPLE || h < EDGE_MULTIPLE) return `Each dimension must be >= ${EDGE_MULTIPLE}px. Got ${w}x${h}`;
  const pixels = w * h;
  if (pixels < MIN_PIXELS) return `Total pixels (${pixels}) below minimum ${MIN_PIXELS}. Got ${w}x${h}`;
  if (pixels > MAX_PIXELS) return `Total pixels (${pixels}) exceeds maximum ${MAX_PIXELS}. Got ${w}x${h}`;
  const ratio = Math.max(w, h) / Math.min(w, h);
  if (ratio > MAX_ASPECT_RATIO) return `Aspect ratio ${ratio.toFixed(1)}:1 exceeds maximum ${MAX_ASPECT_RATIO}:1. Got ${w}x${h}`;
  return null;
}
const VALID_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp']);
const VALID_BACKGROUNDS = new Set(['auto', 'transparent']);
const MAX_N = 10;
const MIN_N = 1;

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * Handle the image command
 */
export async function handleImageCommand(
  prompt: string | undefined,
  options: ImageOptions
): Promise<void> {
  const configManager = new ConfigurationManager(options);
  const inputResolver = new InputResolver();
  const outputFormatter = new OutputFormatter(
    options.json,
    options.quiet ?? false
  );

  try {
    // Load configuration
    const config = await configManager.loadConfig();

    // Resolve provider and model
    const { provider: providerName, model: modelName } = resolveImageModel(options, config);

    // Verify provider exists in config and resolve credentials
    const providerConfig = config.providers.find((p) => p.name === providerName);
    if (!providerConfig) {
      throw new PAIError(
        `Provider not found: ${providerName}`,
        ExitCode.ARGUMENT_ERROR,
        { provider: providerName }
      );
    }

    const apiKey = await configManager.resolveCredentials(providerName, undefined);

    // Resolve prompt input
    const hasExplicitInput = prompt !== undefined || options.inputFile !== undefined;
    const stdinAvailable = !process.stdin.isTTY && !hasExplicitInput;

    const sourceCount = [
      prompt !== undefined,
      stdinAvailable,
      options.inputFile !== undefined,
    ].filter(Boolean).length;

    if (sourceCount > 1) {
      throw new PAIError(
        'Multiple input sources specified',
        ExitCode.ARGUMENT_ERROR,
        { message: 'Provide input via argument, stdin, or --input-file (only one)' }
      );
    }

    let resolvedPrompt: string;
    if (prompt !== undefined) {
      resolvedPrompt = prompt;
    } else if (options.inputFile) {
      resolvedPrompt = (await inputResolver.resolveUserInput({
        file: options.inputFile,
      })) as string;
    } else if (stdinAvailable) {
      resolvedPrompt = (await inputResolver.resolveUserInput({
        stdin: true,
      })) as string;
    } else {
      throw new PAIError(
        'No prompt provided',
        ExitCode.ARGUMENT_ERROR,
        { message: 'Provide a prompt via argument, stdin, or --input-file' }
      );
    }

    // Validate options
    const size = options.size ?? '1024x1024';
    const sizeError = validateSize(size);
    if (sizeError) {
      throw new PAIError(sizeError, ExitCode.ARGUMENT_ERROR);
    }

    const quality = options.quality ?? 'high';
    if (!VALID_QUALITIES.has(quality)) {
      throw new PAIError(
        `Invalid quality: ${quality}. Valid values: ${[...VALID_QUALITIES].join(', ')}`,
        ExitCode.ARGUMENT_ERROR,
      );
    }

    const n = options.n ?? 1;
    if (n < MIN_N || n > MAX_N || !Number.isInteger(n)) {
      throw new PAIError(
        `Invalid n: ${n}. Must be an integer between ${MIN_N} and ${MAX_N}.`,
        ExitCode.ARGUMENT_ERROR,
      );
    }

    const outputFormat = options.outputFormat ?? 'png';
    if (!VALID_OUTPUT_FORMATS.has(outputFormat)) {
      throw new PAIError(
        `Invalid output format: ${outputFormat}. Valid formats: ${[...VALID_OUTPUT_FORMATS].join(', ')}`,
        ExitCode.ARGUMENT_ERROR,
      );
    }

    const background = options.background ?? 'auto';
    if (!VALID_BACKGROUNDS.has(background)) {
      throw new PAIError(
        `Invalid background: ${background}. Valid values: ${[...VALID_BACKGROUNDS].join(', ')}`,
        ExitCode.ARGUMENT_ERROR,
      );
    }

    if (background === 'transparent' && outputFormat !== 'png') {
      throw new PAIError(
        'Transparent background requires PNG output format',
        ExitCode.ARGUMENT_ERROR,
      );
    }

    // Output progress
    outputFormatter.writeProgress({
      type: 'start',
      data: {
        provider: providerName,
        model: modelName,
        mode: (options.image && options.image.length > 0) ? 'edit' : 'generate',
        size,
        quality,
        n,
        outputFormat,
      },
    });

    // Build client config
    const clientConfig: {
      provider: string;
      apiKey: string;
      model: string;
      baseUrl?: string;
      providerOptions?: Record<string, any>;
      api?: string;
    } = {
      provider: providerName,
      apiKey,
      model: modelName,
    };
    if (providerConfig.baseUrl) {
      clientConfig.baseUrl = providerConfig.baseUrl;
    }
    if (providerConfig.providerOptions) {
      clientConfig.providerOptions = providerConfig.providerOptions;
    }
    if (providerConfig.api) {
      clientConfig.api = providerConfig.api;
    }

    const client = new ImageClient(clientConfig);

    // Determine mode: edit (--image provided) or generate
    const isEditMode = options.image && options.image.length > 0;

    // Dashscope adapter currently only supports text->image (文生图).
    if (providerName === 'dashscope' && isEditMode) {
      throw new PAIError(
        'Dashscope provider (qwen-image-2.0-pro) currently supports text->image generation only; edit mode with local images is not supported. Provide image URLs or use another provider.',
        ExitCode.ARGUMENT_ERROR,
      );
    }

    let response: import('../image-client.js').ImageGenerationResponse;

    if (isEditMode) {
      // Validate input images exist
      const { existsSync } = await import('node:fs');
      for (const imgPath of options.image!) {
        if (!existsSync(imgPath)) {
          throw new PAIError(
            `Input image not found: ${imgPath}`,
            ExitCode.IO_ERROR,
            { path: imgPath },
          );
        }
      }
      if (options.mask) {
        if (!existsSync(options.mask)) {
          throw new PAIError(
            `Mask image not found: ${options.mask}`,
            ExitCode.IO_ERROR,
            { path: options.mask },
          );
        }
      }

      response = await client.edit({
        prompt: resolvedPrompt,
        images: options.image!,
        mask: options.mask,
        n,
        size,
        quality,
      });
    } else {
      response = await client.generate({
        prompt: resolvedPrompt,
        n,
        size,
        quality,
        outputFormat,
        background,
      });
    }

    // Output progress complete
    outputFormatter.writeProgress({
      type: 'complete',
      data: {
        created: response.created,
        imageCount: response.images.length,
      },
    });

    // Handle output
    if (options.output) {
      // Write to file(s)
      const outputPaths = await writeImageFiles(response, options.output, outputFormat);
      if (options.json) {
        const jsonOutput = {
          images: response.images.map((img, i) => ({
            path: outputPaths[i],
            revisedPrompt: img.revisedPrompt ?? null,
          })),
          created: response.created,
        };
        process.stdout.write(JSON.stringify(jsonOutput) + '\n');
      } else {
        for (const p of outputPaths) {
          process.stdout.write(p + '\n');
        }
      }
    } else {
      // Output base64 to stdout
      if (options.json) {
        const jsonOutput = {
          images: response.images.map((img) => ({
            b64_json: img.b64Json,
            revised_prompt: img.revisedPrompt ?? null,
          })),
          created: response.created,
        };
        process.stdout.write(JSON.stringify(jsonOutput) + '\n');
      } else {
        for (const img of response.images) {
          process.stdout.write(img.b64Json + '\n');
        }
      }
    }
  } catch (error) {
    if (error instanceof PAIError) {
      outputFormatter.writeError(error);
      process.exit(error.exitCode);
    } else {
      const paiError = new PAIError(
        error instanceof Error ? error.message : String(error),
        ExitCode.RUNTIME_ERROR,
        { originalError: String(error) }
      );
      outputFormatter.writeError(paiError);
      process.exit(ExitCode.RUNTIME_ERROR);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write generated images to files.
 * Single image: write to the exact path.
 * Multiple images: append _1, _2, ... before the extension.
 */
async function writeImageFiles(
  response: { images: { b64Json: string }[] },
  outputPath: string,
  outputFormat: string,
): Promise<string[]> {
  const paths: string[] = [];
  const dir = dirname(outputPath);
  const ext = extname(outputPath) || `.${outputFormat}`;
  const base = basename(outputPath, ext);

  for (let i = 0; i < response.images.length; i++) {
    const img = response.images[i]!;
    const filePath = response.images.length === 1
      ? outputPath
      : join(dir, `${base}_${i + 1}${ext}`);

    try {
      const buffer = Buffer.from(img.b64Json, 'base64');
      await writeFile(filePath, buffer);
      paths.push(filePath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new PAIError(
        `Failed to write image file: ${message}`,
        ExitCode.IO_ERROR,
        { path: filePath, cause: message },
      );
    }
  }

  return paths;
}
