import { getProviders, getModels } from '@mariozechner/pi-ai';
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
    if (options.add) {
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

      // Parse --set options
      if (options.set && options.set.length > 0) {
        for (const setting of options.set) {
          const [key, value] = setting.split('=');
          if (!key || value === undefined) {
            throw new PAIError(
              `Invalid --set format: ${setting}`,
              1,
              { message: 'Use --set key=value' }
            );
          }
          providerConfig[key] = value;
        }
      }

      await configManager.addProvider(providerConfig);

      console.log(`Provider "${options.name}" configured successfully.`);
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
        message: 'Use --add or --delete',
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
