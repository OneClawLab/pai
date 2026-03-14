import type { EmbedOptions } from '../types.js';
import { PAIError, ExitCode } from '../types.js';
import { ConfigurationManager } from '../config-manager.js';
import { InputResolver } from '../input-resolver.js';
import { OutputFormatter } from '../output-formatter.js';
import { EmbeddingClient } from '../embedding-client.js';
import { resolveEmbedModel } from '../embed-model-resolver.js';
import { truncateText } from '../embedding-models.js';
import { parseBatchInput, formatEmbeddingOutput } from '../embed-io.js';

/**
 * Handle the embed command
 */
export async function handleEmbedCommand(
  text: string | undefined,
  options: EmbedOptions
): Promise<void> {
  const configManager = new ConfigurationManager(options);
  const inputResolver = new InputResolver();
  const outputFormatter = new OutputFormatter(
    options.json,
    options.quiet ?? true
  );

  try {
    // Load configuration
    const config = await configManager.loadConfig();

    // Resolve provider and model
    const { provider: providerName, model: modelName } = resolveEmbedModel(options, config);

    // Verify provider exists in config and resolve credentials
    const providerConfig = config.providers.find((p) => p.name === providerName);
    if (!providerConfig) {
      throw new PAIError(
        `Provider not found: ${providerName}`,
        ExitCode.PARAMETER_ERROR,
        { provider: providerName }
      );
    }

    const apiKey = await configManager.resolveCredentials(providerName, undefined);

    // Resolve input text
    const hasExplicitInput = text !== undefined || options.inputFile !== undefined;
    const stdinAvailable = !process.stdin.isTTY && !hasExplicitInput;

    // Count input sources to validate mutual exclusivity
    const sourceCount = [
      text !== undefined,
      stdinAvailable,
      options.inputFile !== undefined,
    ].filter(Boolean).length;

    if (sourceCount > 1) {
      throw new PAIError(
        'Multiple input sources specified',
        ExitCode.PARAMETER_ERROR,
        { message: 'Provide input via argument, stdin, or --input-file (only one)' }
      );
    }

    // Read input using InputResolver
    let rawInput: string;
    if (text !== undefined) {
      rawInput = text;
    } else if (options.inputFile) {
      rawInput = (await inputResolver.resolveUserInput({
        file: options.inputFile,
      })) as string;
    } else if (stdinAvailable) {
      rawInput = (await inputResolver.resolveUserInput({
        stdin: true,
      })) as string;
    } else {
      throw new PAIError(
        'No input text provided',
        ExitCode.PARAMETER_ERROR,
        { message: 'Provide input via argument, stdin, or --input-file' }
      );
    }

    // Parse batch input or wrap single text
    let texts: string[];
    if (options.batch) {
      texts = parseBatchInput(rawInput);
    } else {
      texts = [rawInput];
    }

    // Truncate texts and output warnings
    texts = texts.map((t) => {
      const result = truncateText(t, modelName);
      if (result.truncated) {
        const truncatedTokens = Math.ceil(result.text.length / 4);
        if (options.json) {
          // NDJSON warning event to stderr
          const warning = {
            type: 'warning',
            data: {
              message: `Input text truncated from ~${result.originalTokens} tokens to ${truncatedTokens} tokens (model limit: ${truncatedTokens})`,
              originalTokens: result.originalTokens,
              truncatedTokens,
            },
          };
          process.stderr.write(JSON.stringify(warning) + '\n');
        } else {
          process.stderr.write(
            `[Warning] Input text truncated from ~${result.originalTokens} tokens to ${truncatedTokens} tokens (model limit: ${truncatedTokens})\n`
          );
        }
      }
      return result.text;
    });

    // Output progress
    outputFormatter.writeProgress({
      type: 'start',
      data: {
        provider: providerName,
        model: modelName,
        texts: texts.length,
        batch: options.batch ?? false,
      },
    });

    // Call embedding API
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
    const client = new EmbeddingClient(clientConfig);

    const response = await client.embed({ texts, model: modelName });

    // Output progress complete
    outputFormatter.writeProgress({
      type: 'complete',
      data: {
        model: response.model,
        usage: response.usage,
      },
    });

    // Format and write output to stdout
    const output = formatEmbeddingOutput(response, {
      json: options.json ?? false,
      batch: options.batch ?? false,
    });
    process.stdout.write(output + '\n');
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
