import { getProviders, getModels } from '@mariozechner/pi-ai';
import { getOAuthProvider, getOAuthProviders } from '@mariozechner/pi-ai/oauth';
import { createInterface } from 'node:readline';
import type { ModelConfigOptions } from '../types.js';
import { PAIError } from '../types.js';
import { ConfigurationManager } from '../config-manager.js';

/**
 * Handle model list command
 */
export async function handleModelList(options: ModelConfigOptions): Promise<void> {
  const configManager = new ConfigurationManager(options);

  try {
    const config = await configManager.loadConfig();

    // Show config file path (to stderr so it doesn't pollute JSON output)
    if (!options.json) {
      console.log(`Config: ${configManager.getConfigPath()}\n`);
    } else {
      process.stderr.write(`Config: ${configManager.getConfigPath()}\n`);
    }

    if (options.all) {
      // List all supported providers
      const allProviders = getProviders();
      
      if (options.json) {
        const output = allProviders.map((provider) => {
          const models = getModels(provider as any);
          const configured = config.providers.some((p) => p.name === provider);

          return {
            name: provider,
            provider,
            configured,
            models: models.map((m) => m.id),
          };
        });

        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log('Available Providers:\n');
        for (const provider of allProviders) {
          const models = getModels(provider as any);
          const configured = config.providers.some((p) => p.name === provider);
          const status = configured ? '✓' : ' ';

          console.log(`[${status}] ${provider}`);
          console.log(`    Models: ${models.length} available`);
          if (models.length > 0 && models.length <= 5) {
            models.forEach((m) => console.log(`      - ${m.id}`));
          }
          console.log();
        }
      }
    } else {
      // List only configured providers
      if (config.providers.length === 0) {
        console.log('No providers configured.');
        console.log('Use "pai model config --add" to add a provider.');
        return;
      }

      if (options.json) {
        const output = config.providers.map((p) => ({
          name: p.name,
          provider: p.name,
          configured: true,
          models: p.models || [],
          defaultModel: p.defaultModel,
        }));

        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log('Configured Providers:\n');
        for (const provider of config.providers) {
          console.log(`✓ ${provider.name}`);
          if (provider.defaultModel) {
            console.log(`    Default: ${provider.defaultModel}`);
          }
          if (provider.models && provider.models.length > 0) {
            console.log(`    Models: ${provider.models.join(', ')}`);
          }
          console.log();
        }
      }
    }
  } catch (error) {
    if (error instanceof PAIError) {
      console.error(`Error: ${error.message}`);
      process.exit(error.exitCode);
    } else {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    }
  }
}

/**
 * Handle model config command
 */
export async function handleModelConfig(options: ModelConfigOptions): Promise<void> {
  const configManager = new ConfigurationManager(options);

  try {
    // Show config file path
    process.stderr.write(`Config: ${configManager.getConfigPath()}\n`);

    if (options.show) {
      // Show a single provider's config
      if (!options.name) {
        throw new PAIError('Provider name is required', 1, {
          message: 'Use --name <provider-name>',
        });
      }

      const provider = await configManager.getProvider(options.name);

      // Mask sensitive fields
      const masked: Record<string, any> = { ...provider };
      if (masked.apiKey) masked.apiKey = '***';
      if (masked.oauth) {
        masked.oauth = {
          ...masked.oauth,
          refresh: '***',
          access: '***',
        };
      }

      if (options.json) {
        console.log(JSON.stringify(masked, null, 2));
      } else {
        console.log(`\nProvider: ${provider.name}`);
        for (const [key, value] of Object.entries(masked)) {
          if (key === 'name') continue;
          if (typeof value === 'object' && value !== null) {
            console.log(`  ${key}: ${JSON.stringify(value)}`);
          } else {
            console.log(`  ${key}: ${value}`);
          }
        }
      }
    } else if (options.add) {
      // Add or update provider
      if (!options.name) {
        throw new PAIError('Provider name is required', 1, {
          message: 'Use --name <provider-name>',
        });
      }

      if (!options.provider) {
        throw new PAIError('Provider type is required', 1, {
          message: 'Use --provider <provider-type>',
        });
      }

      // Validate provider is supported
      const supportedProviders = getProviders();
      if (!supportedProviders.includes(options.provider as any)) {
        throw new PAIError(
          `Unsupported provider: ${options.provider}`,
          1,
          {
            message: `Supported providers: ${supportedProviders.join(', ')}`,
          }
        );
      }

      const providerConfig: any = {
        name: options.name,
      };

      // Known configuration keys
      const knownKeys = new Set([
        'apiKey', 'defaultModel', 'models', 'temperature', 'maxTokens',
        'api', 'baseUrl', 'reasoning', 'input', 'contextWindow',
        'providerOptions',
      ]);

      // Parse --set options
      if (options.set && options.set.length > 0) {
        for (const setting of options.set) {
          const eqIndex = setting.indexOf('=');
          if (eqIndex < 1) {
            throw new PAIError(
              `Invalid --set format: ${setting}`,
              1,
              { message: 'Use --set key=value' }
            );
          }
          const key = setting.substring(0, eqIndex);
          const value = setting.substring(eqIndex + 1);

          // Warn on unknown keys (but still allow them for extensibility)
          const topKey = key.split('.')[0]!;
          if (!knownKeys.has(topKey)) {
            console.error(`Warning: unknown key "${key}". Known keys: ${[...knownKeys].join(', ')}`);
          }

          // Support nested keys like providerOptions.azureApiVersion
          if (key.includes('.')) {
            const parts = key.split('.');
            let target = providerConfig;
            for (let i = 0; i < parts.length - 1; i++) {
              const part = parts[i]!;
              if (!target[part] || typeof target[part] !== 'object') {
                target[part] = {};
              }
              target = target[part];
            }
            target[parts[parts.length - 1]!] = value;
          } else {
            providerConfig[key] = value;
          }
        }
      }

      await configManager.addProvider(providerConfig);

      // Set as default provider if --default flag is provided
      if (options.default) {
        await configManager.setDefaultProvider(options.name);
      }

      console.log(`Provider "${options.name}" configured successfully.`);
    } else if (options.update) {
      // Update existing provider fields
      if (!options.name) {
        throw new PAIError('Provider name is required', 1, {
          message: 'Use --name <provider-name>',
        });
      }

      if (!options.set || options.set.length === 0) {
        throw new PAIError('No fields to update', 1, {
          message: 'Use --set key=value to specify fields to update',
        });
      }

      // Known configuration keys
      const knownKeys = new Set([
        'apiKey', 'defaultModel', 'models', 'temperature', 'maxTokens',
        'api', 'baseUrl', 'reasoning', 'input', 'contextWindow',
        'providerOptions',
      ]);

      const updates: Record<string, any> = {};

      for (const setting of options.set) {
        const eqIndex = setting.indexOf('=');
        if (eqIndex < 1) {
          throw new PAIError(
            `Invalid --set format: ${setting}`,
            1,
            { message: 'Use --set key=value' }
          );
        }
        const key = setting.substring(0, eqIndex);
        const value = setting.substring(eqIndex + 1);

        const topKey = key.split('.')[0]!;
        if (!knownKeys.has(topKey)) {
          console.error(`Warning: unknown key "${key}". Known keys: ${[...knownKeys].join(', ')}`);
        }

        if (key.includes('.')) {
          const parts = key.split('.');
          let target = updates;
          for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i]!;
            if (!target[part] || typeof target[part] !== 'object') {
              target[part] = {};
            }
            target = target[part];
          }
          target[parts[parts.length - 1]!] = value;
        } else {
          updates[key] = value;
        }
      }

      await configManager.updateProvider(options.name, updates);

      // Set as default provider if --default flag is provided
      if (options.default) {
        await configManager.setDefaultProvider(options.name);
      }

      console.log(`Provider "${options.name}" updated successfully.`);
    } else if (options.delete) {
      // Delete provider
      if (!options.name) {
        throw new PAIError('Provider name is required', 1, {
          message: 'Use --name <provider-name>',
        });
      }

      await configManager.deleteProvider(options.name);

      console.log(`Provider "${options.name}" deleted successfully.`);
    } else {
      throw new PAIError('No action specified', 1, {
        message: 'Use --add, --update, --delete, or --show',
      });
    }
  } catch (error) {
    if (error instanceof PAIError) {
      console.error(`Error: ${error.message}`);
      if (error.context) {
        console.error(`Context: ${JSON.stringify(error.context)}`);
      }
      process.exit(error.exitCode);
    } else {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    }
  }
}


/**
 * Handle model default command — view or set the default provider
 */
export async function handleModelDefault(options: ModelConfigOptions): Promise<void> {
  const configManager = new ConfigurationManager(options);

  try {
    if (options.name) {
      // Set default provider
      await configManager.setDefaultProvider(options.name);
      console.log(`Default provider set to "${options.name}".`);
    } else {
      // Show current default provider
      const config = await configManager.loadConfig();

      if (options.json) {
        console.log(JSON.stringify({ defaultProvider: config.defaultProvider ?? null }));
      } else {
        if (config.defaultProvider) {
          console.log(`Default provider: ${config.defaultProvider}`);
        } else {
          console.log('No default provider configured.');
          console.log('Use "pai model default --name <provider>" to set one.');
        }
      }
    }
  } catch (error) {
    if (error instanceof PAIError) {
      console.error(`Error: ${error.message}`);
      if (error.context) {
        console.error(`Context: ${JSON.stringify(error.context)}`);
      }
      process.exit(error.exitCode);
    } else {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    }
  }
}

/**
 * Handle model login command (OAuth providers)
 */
export async function handleModelLogin(options: ModelConfigOptions): Promise<void> {
  const configManager = new ConfigurationManager(options);

  try {
    if (!options.name) {
      throw new PAIError('Provider name is required', 1, {
        message: 'Use --name <provider-name>',
      });
    }

    // Check if this is an OAuth provider
    const oauthProviders = getOAuthProviders();
    const oauthProvider = getOAuthProvider(options.name);

    if (!oauthProvider) {
      const oauthIds = oauthProviders.map((p) => p.id).join(', ');
      throw new PAIError(
        `Provider "${options.name}" does not support OAuth login`,
        1,
        { message: `OAuth providers: ${oauthIds}` }
      );
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const prompt = (msg: string): Promise<string> =>
      new Promise((resolve) => rl.question(`${msg} `, resolve));

    try {
      console.log(`Logging in to ${oauthProvider.name}...`);

      const credentials = await oauthProvider.login({
        onAuth: (info) => {
          console.log(`\nOpen this URL in your browser:\n${info.url}`);
          if (info.instructions) console.log(info.instructions);
          console.log();
        },
        onPrompt: async (p) => {
          return await prompt(
            `${p.message}${p.placeholder ? ` (${p.placeholder})` : ''}:`
          );
        },
        onProgress: (msg) => console.log(msg),
      });

      // Load existing provider config or create new one
      let providerConfig;
      try {
        providerConfig = await configManager.getProvider(options.name);
      } catch {
        providerConfig = { name: options.name };
      }

      // Store OAuth credentials in the provider config
      providerConfig.oauth = {
        refresh: credentials.refresh,
        access: credentials.access,
        expires: credentials.expires,
        ...(Object.fromEntries(
          Object.entries(credentials).filter(
            ([k]) => !['refresh', 'access', 'expires'].includes(k)
          )
        )),
      };

      await configManager.addProvider(providerConfig);

      console.log(`\nProvider "${options.name}" logged in and credentials saved to config.`);
    } finally {
      rl.close();
    }
  } catch (error) {
    if (error instanceof PAIError) {
      console.error(`Error: ${error.message}`);
      if (error.context) {
        console.error(`Context: ${JSON.stringify(error.context)}`);
      }
      process.exit(error.exitCode);
    } else {
      console.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(2);
    }
  }
}
