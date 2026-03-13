import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { PAIConfig, ProviderConfig, CLIOptions, ExitCode } from './types.js';
import { PAIError } from './types.js';

const DEFAULT_SCHEMA_VERSION = '1.0.0';

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

      // Validate providers field exists and is an array
      if (!config.providers) {
        throw new PAIError(
          'Config file is missing providers field',
          4 as ExitCode,
          { path: this.configPath }
        );
      }

      if (!Array.isArray(config.providers)) {
        throw new PAIError(
          'Config file providers field must be an array',
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
   * Patch an existing provider configuration (merge fields)
   */
  async updateProvider(name: string, updates: Record<string, any>): Promise<void> {
    const config = await this.loadConfig();

    const existingIndex = config.providers.findIndex((p) => p.name === name);

    if (existingIndex < 0) {
      throw new PAIError(
        `Provider not found: ${name}`,
        1 as ExitCode,
        { provider: name, configPath: this.configPath }
      );
    }

    // Deep merge updates into existing config
    const existing = config.providers[existingIndex]!;
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'name') continue; // Don't allow renaming
      if (typeof value === 'object' && value !== null && !Array.isArray(value) &&
          typeof (existing as any)[key] === 'object' && (existing as any)[key] !== null) {
        // Merge nested objects (e.g. providerOptions)
        (existing as any)[key] = { ...(existing as any)[key], ...value };
      } else {
        (existing as any)[key] = value;
      }
    }

    config.providers[existingIndex] = existing;
    await this.saveConfig(config);
  }

  /**
   * Set the default provider
   */
  async setDefaultProvider(name: string): Promise<void> {
    const config = await this.loadConfig();

    // Verify provider exists
    const exists = config.providers.some((p) => p.name === name);
    if (!exists) {
      throw new PAIError(
        `Provider not found: ${name}`,
        1 as ExitCode,
        { provider: name, configPath: this.configPath }
      );
    }

    config.defaultProvider = name;
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

    // Clear defaultProvider if the deleted provider was the default
    if (config.defaultProvider === name) {
      delete config.defaultProvider;
    }

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
   * Priority: CLI param > env var > config file (apiKey or oauth)
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

    // 3. Check config file (apiKey or OAuth credentials)
    try {
      const providerConfig = await this.getProvider(provider);

      // 3a. Direct API key
      if (providerConfig.apiKey) {
        return providerConfig.apiKey;
      }

      // 3b. OAuth credentials stored in config
      if (providerConfig.oauth) {
        const oauthApiKey = await this.resolveOAuthCredentials(providerConfig);
        if (oauthApiKey) {
          return oauthApiKey;
        }
      }
    } catch {
      // Provider not in config
    }

    throw new PAIError(
      `No credentials found for provider: ${provider}`,
      1 as ExitCode,
      {
        provider,
        checkedSources: ['CLI parameter', 'environment variable', 'config file'],
      }
    );
  }

  /**
   * Resolve OAuth credentials from provider config.
   * Automatically refreshes expired tokens and saves updated credentials.
   */
  private async resolveOAuthCredentials(
    providerConfig: ProviderConfig
  ): Promise<string | null> {
    const oauth = providerConfig.oauth;
    if (!oauth || !oauth.access) {
      return null;
    }

    // Check if token is expired
    if (oauth.expires && Date.now() >= oauth.expires) {
      // Try to refresh the token
      try {
        const { getOAuthProvider } = await import('@mariozechner/pi-ai/oauth');
        const oauthProvider = getOAuthProvider(providerConfig.name);
        if (oauthProvider) {
          const newCredentials = await oauthProvider.refreshToken(oauth as any);
          // Update config with refreshed credentials
          providerConfig.oauth = {
            ...oauth,
            refresh: newCredentials.refresh,
            access: newCredentials.access,
            expires: newCredentials.expires,
          };
          await this.addProvider(providerConfig);
          return oauthProvider.getApiKey(providerConfig.oauth as any);
        }
      } catch {
        // Refresh failed, return existing token (may still work)
      }
    }

    // Use getApiKey if available (some providers encode extra fields)
    try {
      const { getOAuthProvider } = await import('@mariozechner/pi-ai/oauth');
      const oauthProvider = getOAuthProvider(providerConfig.name);
      if (oauthProvider) {
        return oauthProvider.getApiKey(oauth as any);
      }
    } catch {
      // Fall back to raw access token
    }

    return oauth.access;
  }
}
