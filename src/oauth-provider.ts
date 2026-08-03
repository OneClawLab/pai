/**
 * OAuth compatibility adapter.
 *
 * pi-ai 0.83 removed the standalone `getOAuthProvider()` / `getOAuthProviders()`
 * runtime API — the `@earendil-works/pi-ai/oauth` subpath is now type-only.
 * OAuth is expressed as an `OAuthAuth` attached to each built-in provider, and
 * refresh / request-auth derivation happen via `OAuthAuth.refresh()` and
 * `OAuthAuth.toAuth()`, orchestrated through the built-in provider catalog.
 *
 * This module re-exposes pai's original OAuth-provider shape (`login` /
 * `refreshToken` / `getApiKey`) on top of the new API so existing call sites
 * (config-manager, lib/config, commands/model) need only change their import.
 */
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type {
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  ModelAuth,
  OAuthCredential,
  Provider,
} from '@earendil-works/pi-ai';

/** Stored OAuth credential shape used by pai config (no `type` discriminator). */
export interface OAuthCredentials {
  refresh: string;
  access: string;
  expires: number;
  [key: string]: unknown;
}

/** Old-style login callbacks preserved for pai's interactive `model login` command. */
export interface OAuthLoginCallbacks {
  onAuth?: (info: { url: string; instructions?: string }) => void;
  onPrompt?: (p: { message: string; placeholder?: string }) => Promise<string>;
  onProgress?: (message: string) => void;
}

/** pai's original OAuth provider interface, backed by pi-ai 0.83 `OAuthAuth`. */
export interface OAuthProviderCompat {
  id: string;
  name: string;
  login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
  getApiKey(credentials: OAuthCredentials): Promise<string | undefined>;
}

// `builtinProviders()` freshly constructs the whole catalog on each call;
// memoize since provider auth definitions are stateless.
let providersCache: Provider[] | undefined;
function allProviders(): Provider[] {
  return (providersCache ??= builtinProviders());
}

/** pai stores credentials without the pi-ai `type: 'oauth'` discriminator. */
function toOAuthCredential(cred: OAuthCredentials): OAuthCredential {
  return { type: 'oauth', ...cred };
}

function fromOAuthCredential(cred: OAuthCredential): OAuthCredentials {
  const { type: _type, ...rest } = cred;
  return rest as OAuthCredentials;
}

/** Bridge pai's old login callbacks to pi-ai's `AuthInteraction`. */
function buildInteraction(callbacks: OAuthLoginCallbacks): AuthInteraction {
  return {
    async prompt(prompt: AuthPrompt): Promise<string> {
      if (!callbacks.onPrompt) {
        throw new Error(`OAuth login requires an interactive prompt: ${prompt.message}`);
      }
      const placeholder = 'placeholder' in prompt ? prompt.placeholder : undefined;
      return callbacks.onPrompt({
        message: prompt.message,
        ...(placeholder ? { placeholder } : {}),
      });
    },
    notify(event: AuthEvent): void {
      switch (event.type) {
        case 'progress':
        case 'info':
          callbacks.onProgress?.(event.message);
          break;
        case 'auth_url':
          callbacks.onAuth?.({
            url: event.url,
            ...(event.instructions ? { instructions: event.instructions } : {}),
          });
          break;
        case 'device_code':
          callbacks.onAuth?.({
            url: event.verificationUri,
            instructions: `Enter code: ${event.userCode}`,
          });
          break;
      }
    },
  };
}

/** List built-in providers that support OAuth login. */
export function getOAuthProviders(): Array<{ id: string; name: string }> {
  const result: Array<{ id: string; name: string }> = [];
  for (const provider of allProviders()) {
    const oauth = provider.auth.oauth;
    if (oauth) result.push({ id: provider.id, name: oauth.name });
  }
  return result;
}

/** Get an OAuth-capable provider by id, or `undefined` if it has no OAuth flow. */
export function getOAuthProvider(providerId: string): OAuthProviderCompat | undefined {
  const provider = allProviders().find((p) => p.id === providerId);
  const oauth = provider?.auth.oauth;
  if (!provider || !oauth) return undefined;

  return {
    id: provider.id,
    name: oauth.name,
    async login(callbacks) {
      const cred = await oauth.login(buildInteraction(callbacks));
      return fromOAuthCredential(cred);
    },
    async refreshToken(credentials) {
      const cred = await oauth.refresh(toOAuthCredential(credentials));
      return fromOAuthCredential(cred);
    },
    async getApiKey(credentials) {
      const auth: ModelAuth = await oauth.toAuth(toOAuthCredential(credentials));
      return auth.apiKey;
    },
  };
}
