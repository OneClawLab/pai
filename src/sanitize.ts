// Centralized redaction utilities
// Provides functions to sanitize strings and structured objects before
// writing them to stdout/stderr or logs.

const SENSITIVE_KEYS = new Set([
  'apikey', 'api_key', 'apiKey', 'access', 'access_token', 'refresh', 'refresh_token',
  'token', 'oauth', 'client_secret', 'client-secret', 'secret', 'password', 'passwd', 'authorization', 'auth'
]);

type SanitizeResult = { sanitized: any; secrets: string[] };

function isObject(v: any): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function maskPartial(s: string, keep = 4): string {
  if (s.length <= keep * 2) return '*'.repeat(s.length);
  return s.slice(0, keep) + '*'.repeat(Math.max(0, s.length - keep * 2)) + s.slice(-keep);
}

// Common provider-specific and generic patterns
const PATTERNS: Array<{ re: RegExp; replace: (m: string) => string }> = [
  // URL query params like ?key=... or &token=...
  { re: /(https?:\/\/[^\s]*?[?&](?:api_key|apikey|key|token|access_token|auth)=)([^&\s]+)/gi, replace: (_m) => '***REDACTED***' },
  // OpenAI keys
  { re: /\bsk-[A-Za-z0-9\-_]{16,}\b/g, replace: (m) => maskPartial(m, 6) },
  // Anthropic-ish
  { re: /\bsk-ant-[A-Za-z0-9\-_]{8,}\b/g, replace: (m) => maskPartial(m, 6) },
  // HuggingFace
  { re: /\bhf_[A-Za-z0-9\-_]{16,}\b/g, replace: (m) => maskPartial(m, 6) },
  // Bearer tokens (simple)
  { re: /\bBearer\s+[A-Za-z0-9\-\._=\/+]{8,}\b/gi, replace: () => 'Bearer ***REDACTED***' },
  // JWT-ish (three base64url parts)
  { re: /\b[a-zA-Z0-9-_]{10,}\.[a-zA-Z0-9-_]{10,}\.[a-zA-Z0-9-_]{8,}\b/g, replace: () => 'JWT <redacted>' },
  // Long base64-like strings (avoid short hashes)
  { re: /\b[A-Za-z0-9+\/]{40,}={0,2}\b/g, replace: () => '***REDACTED***' },
];

/**
 * Redact sensitive substrings from a plain string using pattern matching.
 */
export function sanitizeString(input: string): { sanitized: string; secrets: string[] } {
  if (!input) return { sanitized: input, secrets: [] };

  let out = input;
  const found: string[] = [];

  // First handle URL param style with capture groups to preserve prefix
  out = out.replace(/(https?:\/\/[^\s]*?[?&](?:api_key|apikey|key|token|access_token|auth)=)([^&\s]+)/gi, (_, prefix, secret) => {
    found.push(secret);
    return prefix + '***REDACTED***';
  });

  for (const p of PATTERNS) {
    out = out.replace(p.re, (m) => {
      // Record the raw match as a discovered secret when it looks token-like
      found.push(m);
      try {
        return p.replace(m);
      } catch {
        return '***REDACTED***';
      }
    });
  }

  return { sanitized: out, secrets: found };
}

/**
 * Sanitize structured data (objects/arrays) by key name and by inspecting string values.
 */
export function sanitizeContent(value: any): SanitizeResult {
  const secrets: string[] = [];

  function _sanitize(v: any): any {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string') {
      const { sanitized, secrets: s } = sanitizeString(v);
      secrets.push(...s);
      return sanitized;
    }
    if (Array.isArray(v)) {
      return v.map((item) => _sanitize(item));
    }
    if (isObject(v)) {
      const out: Record<string, any> = {};
      for (const [k, val] of Object.entries(v)) {
        try {
          if (SENSITIVE_KEYS.has(k.toLowerCase()) || SENSITIVE_KEYS.has(k)) {
            // Mask sensitive field values
            if (typeof val === 'string') {
              secrets.push(String(val));
              out[k] = '***REDACTED***';
            } else {
              out[k] = '***REDACTED***';
            }
          } else {
            out[k] = _sanitize(val);
          }
        } catch (e) {
          // On unexpected error, fall back to stringifying and sanitizing
          const str = String(val);
          const { sanitized, secrets: s } = sanitizeString(str);
          secrets.push(...s);
          out[k] = sanitized;
        }
      }
      return out;
    }
    // primitives
    return v;
  }

  const sanitized = _sanitize(value);
  return { sanitized, secrets };
}

export default { sanitizeString, sanitizeContent };
