import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { PAIConfig, ProviderConfig, CLIOptions, ExitCode } from './types.js';
import { PAIError } from './types.js';

const DEFAULT_SCHEMA_VERSION = '1.0.0';

interface AuthFile {
  [provider: string]: {
    type: 'oauth' | 'api_key';
    access?: string;
    refresh?: string;
    expires?: number;
    apiKey?: string;
  };
}

export class ConfigurationManager {
  private configPath: string;

  constructor(options: CLIOptions = {}) {
    // Priority: --config > PAI_CONFIG env > ~/config/pai/default.json
    this.configPath =
      options.config ||
      process.env.PAI_CONFIG ||
      join(homedir(), 'config', 'pai', 'default.json');
  }

  /**
   * Load configuration from file
   * Returns default config if file doesn't exist
   */
  async loadConfig(): Promise<PAIConfig> {
    if (!existsSync(this.configPath)) {
      return this.getDefaultConfig();
    }

    try {
      const content = await readFile(this.configPath, 'utf-8');
      const config = JSON.parse(content) as PAIConfig;

      // Validate schema_version exists
      if (!config.schema_version) {
        throw new PAIError(
          'Config file is missing schema_version field',
          4 as ExitCode,
          { path: this.configPath }
        );
      }

      return config;
    } catch (error) {
      if (error instanceof PAIError) {
        throw error;
      }

      if (error instanceof SyntaxError) {
        throw new PAIError(
          'Config file is malformed',
          4 as ExitCode,
          { path: this.configPath, error: error.message }
        );
      }

      throw new PAIError(
        'Failed to read config file',
        4 as ExitCode,
        { path: this.configPath, error: String(error) }
      );
    }
  }

  /**
   * Save configuration to file
   * Creates directory if needed
   */
  async saveConfig(config: PAIConfig): Promise<void> {
    // Ensure schema_version is present
    if (!config.schema_version) {
      config.schema_version = DEFAULT_SCHEMA_VERSION;
    }

    try {
      // Create directory if it doesn't exist
      const dir = dirname(this.configPath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      // Write config file with formatting
      const content = JSON.stringify(config, null, 2);
      await writeFile(this.configPath, content, 'utf-8');
    } catch (error) {
      throw new PAIError(
        'Failed to write config file',
        4 as ExitCode,
        { path: this.configPath, error: String(error) }
      );
    }
  }

  /**
   * Get provider configuration by name
   * Throws error if not found
   */
  async getProvider(name?: string): Promise<ProviderConfig> {
    const config = await this.loadConfig();

    // Use specified name or default provider
    const providerName = name || config.defaultProvider;

    if (!providerName) {
      throw new PAIError(
        'No provider specified and no default provider configured',
        1 as ExitCode,
        { configPath: this.configPath }
      );
    }

    const provider = config.providers.find((p) => p.name === providerName);

    if (!provider) {
      throw new PAIError(
        `Provider not found: ${providerName}`,
        1 as ExitCode,
        { provider: providerName, configPath: this.configPath }
      );
    }

    return provider;
  }

  /**
   * Add or update a provider configuration
   */
  async addProvider(provider: ProviderConfig): Promise<void> {
    const config = await this.loadConfig();

    // Find existing provider index
    const existingIndex = config.providers.findIndex(
      (p) => p.name === provider.name
    );

    if (existingIndex >= 0) {
      // Update existing provider
      config.providers[existingIndex] = provider;
    } else {
      // Add new provider
      config.providers.push(provider);
    }

    await this.saveConfig(config);
  }

  /**
   * Delete a provider configuration
   */
  async deleteProvider(name: string): Promise<void> {
    const config = await this.loadConfig();

    const existingIndex = config.providers.findIndex((p) => p.name === name);

    if (existingIndex < 0) {
      throw new PAIError(
        `Provider not found: ${name}`,
        1 as ExitCode,
        { provider: name, configPath: this.configPath }
      );
    }

    config.providers.splice(existingIndex, 1);
    await this.saveConfig(config);
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): PAIConfig {
    return {
      schema_version: DEFAULT_SCHEMA_VERSION,
      providers: [],
    };
  }

  /**
   * Get config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Resolve credentials for a provider
   * Priority: CLI param > env var > config file > auth.json
   */
  async resolveCredentials(
    provider: string,
    cliKey?: string
  ): Promise<string> {
    // 1. Check CLI parameter
    if (cliKey) {
      return cliKey;
    }

    // 2. Check environment variable (PAI_<PROVIDER>_API_KEY pattern)
    const envVarName = `PAI_${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
    const envKey = process.env[envVarName];
    if (envKey) {
      return envKey;
    }

    // 3. Check config file
    try {
      const providerConfig = await this.getProvider(provider);
      if (providerConfig.apiKey) {
        return providerConfig.apiKey;
      }
    } catch {
      // Provider not in config, continue to auth.json
    }

    // 4. Check auth.json for OAuth credentials
    const authKey = await this.loadAuthFile(provider);
    if (authKey) {
      return authKey;
    }

    throw new PAIError(
      `No credentials found for provider: ${provider}`,
      1 as ExitCode,
      {
        provider,
        checkedSources: ['CLI parameter', 'environment variable', 'config file', 'auth.json'],
      }
    );
  }

  /**
   * Load credentials from auth.json file (pi-ai format)
   */
  private async loadAuthFile(provider: string): Promise<string | null> {
    // Check for auth.json in current directory
    const authPath = join(process.cwd(), 'auth.json');

    if (!existsSync(authPath)) {
      return null;
    }

    try {
      const content = await readFile(authPath, 'utf-8');
      const auth = JSON.parse(content) as AuthFile;

      const providerAuth = auth[provider];
      if (!providerAuth) {
        return null;
      }

      // For OAuth providers, return the access token
      if (providerAuth.type === 'oauth' && providerAuth.access) {
        return providerAuth.access;
      }

      // For API key providers
      if (providerAuth.apiKey) {
        return providerAuth.apiKey;
      }

      return null;
    } catch {
      // If auth.json is malformed or unreadable, ignore it
      return null;
    }
  }
}
