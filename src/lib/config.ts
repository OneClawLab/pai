import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { PAIConfig, ProviderConfig, ExitCode } from './types.js';
import { PAIError } from './types.js';

const DEFAULT_SCHEMA_VERSION = '1.0.0';

function getDefaultConfig(): PAIConfig {
  return {
    schema_version: DEFAULT_SCHEMA_VERSION,
    providers: [],
  };
}

/**
 * Load PAI configuration from file.
 * Priority: configPath > PAI_CONFIG env var > ~/.config/pai/default.json
 * If file doesn't exist, returns default empty config.
 */
export async function loadConfig(configPath?: string): Promise<PAIConfig> {
  const resolvedPath =
    configPath ||
    process.env['PAI_CONFIG'] ||
    join(homedir(), '.config', 'pai', 'default.json');

  if (!existsSync(resolvedPath)) {
    return getDefaultConfig();
  }

  try {
    const content = await readFile(resolvedPath, 'utf-8');
    const config = JSON.parse(content) as PAIConfig;

    if (!config.schema_version) {
      throw new PAIError(
        'Config file is missing schema_version field',
        4 as ExitCode,
        { path: resolvedPath }
      );
    }

    if (!config.providers) {
      throw new PAIError(
        'Config file is missing providers field',
        4 as ExitCode,
        { path: resolvedPath }
      );
    }

    if (!Array.isArray(config.providers)) {
      throw new PAIError(
        'Config file providers field must be an array',
        4 as ExitCode,
        { path: resolvedPath }
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
        { path: resolvedPath, error: error.message }
      );
    }

    throw new PAIError(
      'Failed to read config file',
      4 as ExitCode,
      { path: resolvedPath, error: String(error) }
    );
  }
}

/**
 * Resolve a provider and its API key from config.
 * Credential priority: env var (PAI_<PROVIDER>_API_KEY) > config apiKey > OAuth
 * Throws PAIError if provider is not found.
 */
export async function resolveProvider(
  config: PAIConfig,
  providerName?: string,
): Promise<{ provider: ProviderConfig; apiKey: string }> {
  const name = providerName || config.defaultProvider;

  if (!name) {
    throw new PAIError(
      'No provider specified and no default provider configured',
      2 as ExitCode,
      {}
    );
  }

  const provider = config.providers.find((p) => p.name === name);

  if (!provider) {
    throw new PAIError(
      `Provider not found: ${name}`,
      2 as ExitCode,
      { provider: name }
    );
  }

  // 1. Environment variable
  const envVarName = `PAI_${name.toUpperCase().replace(/-/g, '_')}_API_KEY`;
  const envKey = process.env[envVarName];
  if (envKey) {
    return { provider, apiKey: envKey };
  }

  // 2. Config file apiKey
  if (provider.apiKey) {
    return { provider, apiKey: provider.apiKey };
  }

  // 3. OAuth credentials
  if (provider.oauth) {
    const oauthKey = await resolveOAuthCredentials(provider);
    if (oauthKey) {
      return { provider, apiKey: oauthKey };
    }
  }

  throw new PAIError(
    `No credentials found for provider: ${name}`,
    2 as ExitCode,
    {
      provider: name,
      checkedSources: ['environment variable', 'config file', 'oauth'],
    }
  );
}

/**
 * Resolve OAuth credentials, refreshing if expired.
 */
async function resolveOAuthCredentials(
  providerConfig: ProviderConfig,
): Promise<string | null> {
  const oauth = providerConfig.oauth;
  if (!oauth || !oauth.access) {
    return null;
  }

  // Check if token is expired and try to refresh
  if (oauth.expires && Date.now() >= oauth.expires) {
    try {
      const { getOAuthProvider } = await import('@mariozechner/pi-ai/oauth');
      const oauthProvider = getOAuthProvider(providerConfig.name);
      if (oauthProvider) {
        const newCredentials = await oauthProvider.refreshToken(oauth as any);
        providerConfig.oauth = {
          ...oauth,
          refresh: newCredentials.refresh,
          access: newCredentials.access,
          expires: newCredentials.expires,
        };
        return oauthProvider.getApiKey(providerConfig.oauth as any);
      }
    } catch {
      // Refresh failed, fall through to use existing token
    }
  }

  // Use getApiKey if available
  try {
    const { getOAuthProvider } = await import('@mariozechner/pi-ai/oauth');
    const oauthProvider = getOAuthProvider(providerConfig.name);
    if (oauthProvider) {
      return oauthProvider.getApiKey(oauth as any);
    }
  } catch {
    // Fall back to raw access token
  }

  return oauth.access as string;
}
