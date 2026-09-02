import { describe, expect, it } from 'vitest';
import pino from 'pino';
import {
  LOG_REDACT_CONFIG,
  SENSITIVE_LOG_KEYS,
  sanitizeLogContext,
  sanitizeLogText,
  sanitizeUrl,
} from './logger.js';

/**
 * Drives a pino logger with the exact redaction config the real logger uses,
 * writing to a synchronous in-memory sink so we can assert on the serialized
 * output. This validates that credentials, cookies and tokens never reach a
 * log sink — the Phase 7.1 "sensitive data is covered by logging tests" gate.
 */
function captureLog(obj: Record<string, unknown>, msg = 'event'): { raw: string; parsed: Record<string, unknown> } {
  const lines: string[] = [];
  const stream = { write: (s: string) => { lines.push(s); } };
  const log = pino({ redact: LOG_REDACT_CONFIG, base: undefined }, stream as unknown as pino.DestinationStream);
  log.info(obj, msg);
  const raw = lines.join('');
  return { raw, parsed: JSON.parse(raw) as Record<string, unknown> };
}

describe('sanitizeUrl', () => {
  it('strips userinfo credentials', () => {
    expect(sanitizeUrl('https://user:s3cret@private.example.com/doc'))
      .toBe('https://private.example.com/doc');
  });

  it('redacts sensitive query parameters but keeps the rest', () => {
    const out = sanitizeUrl('https://example.com/login?token=abc123&doc=bgb.p823&jwt=eyJ');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('eyJ');
    expect(out).toContain('token=%5Bredacted%5D');
    expect(out).toContain('doc=bgb.p823');
  });

  it('is case-insensitive on parameter names', () => {
    expect(sanitizeUrl('https://example.com/x?Token=abc&Session=xyz')).not.toContain('abc');
  });

  it('strips inline userinfo from non-parseable strings without throwing', () => {
    // Protocol-relative URL: `new URL()` needs a temporary scheme.
    expect(sanitizeUrl('//admin:hunter2@host/path')).toBe('//host/path');
  });

  it('strips userinfo even from exotic but parseable schemes', () => {
    expect(sanitizeUrl('ldap://admin:hunter2@host')).toBe('ldap://host');
  });

  it('leaves a plain vpath untouched', () => {
    expect(sanitizeUrl('bibdata/ges/bgb/cont/bgb.p823.htm'))
      .toBe('bibdata/ges/bgb/cont/bgb.p823.htm');
  });

  it('returns empty/non-strings unchanged', () => {
    expect(sanitizeUrl('')).toBe('');
  });

  it('redacts a nested qurl carrying OIDC credentials while preserving the outer route', () => {
    const nested = 'https://oidc-user:oidc-pass@idp.example/callback?code=OIDC-CODE&id_token=OIDC-TOKEN';
    const out = sanitizeUrl(
      `https://login.example/sign-in?qurl=${encodeURIComponent(nested)}&document=bgb.p823`,
    );

    expect(out).toContain('https://login.example/sign-in');
    expect(out).toContain('document=bgb.p823');
    expect(out).toContain('qurl=%5Bredacted%5D');
    expect(out).not.toContain('oidc-user');
    expect(out).not.toContain('oidc-pass');
    expect(out).not.toContain('OIDC-CODE');
    expect(out).not.toContain('OIDC-TOKEN');
  });

  it('fails closed for multiply encoded nested URLs and encoded parameter names', () => {
    const target = 'https://nested-user:nested-pass@example.invalid/cb?token=NESTED-TOKEN';
    const multiplyEncoded = encodeURIComponent(encodeURIComponent(encodeURIComponent(target)));
    const encodedQurlName = 'q%2575rl';
    const out = sanitizeUrl(
      `https://login.example/?${encodedQurlName}=${multiplyEncoded}`,
    );

    expect(out).toContain('%5Bredacted%5D');
    expect(out).not.toContain('nested-user');
    expect(out).not.toContain('nested-pass');
    expect(out).not.toContain('NESTED-TOKEN');
  });

  it('redacts URL- and query-like values even under an unknown wrapper parameter', () => {
    const nestedQuery = encodeURIComponent('code=INNER-CODE&access_token=INNER-TOKEN');
    const out = sanitizeUrl(`https://example.com/redirect?payload=${nestedQuery}&step=2`);

    expect(out).toContain('payload=%5Bredacted%5D');
    expect(out).toContain('step=2');
    expect(out).not.toContain('INNER-CODE');
    expect(out).not.toContain('INNER-TOKEN');
  });

  it('redacts oversized URLs without parsing or copying attacker-controlled content', () => {
    const out = sanitizeUrl(
      `https://example.com/?qurl=${'x'.repeat(20_000)}OVERSIZED-SECRET`,
    );

    expect(out).toBe('[redacted:oversized-url]');
    expect(out).not.toContain('OVERSIZED-SECRET');
  });
});

describe('logger redaction', () => {
  it('redacts every known sensitive key at the top level', () => {
    const secret = 'MUST-NOT-APPEAR';
    const obj: Record<string, unknown> = {};
    for (const key of SENSITIVE_LOG_KEYS) obj[key] = secret;

    const { raw, parsed } = captureLog(obj);

    expect(raw).not.toContain(secret);
    for (const key of SENSITIVE_LOG_KEYS) {
      expect(parsed[key]).toBe('[redacted]');
    }
  });

  it('redacts sensitive keys nested one level deep', () => {
    const { raw, parsed } = captureLog({
      error: { name: 'AuthError', password: 'hunter2', token: 'abc', message: 'boom' },
    });
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('abc');
    const error = parsed.error as Record<string, unknown>;
    expect(error.password).toBe('[redacted]');
    expect(error.token).toBe('[redacted]');
    expect(error.message).toBe('boom'); // non-sensitive sibling preserved
  });

  it('redacts provider-specific and future token-suffixed keys', () => {
    const context = sanitizeLogContext({
      octaToken: 'octa-secret',
      xSHISecurity: 'viewer-secret',
      csrfToken: 'csrf-secret',
      jwtCookie: 'jwt-secret',
      unexpectedSessionToken: 'future-secret',
    });
    expect(JSON.stringify(context)).not.toContain('secret');
  });

  it('redacts structured qurl values instead of trusting their target URL', () => {
    const context = sanitizeLogContext({
      navigation: {
        qurl: encodeURIComponent('https://u:p@example.invalid/cb?code=STRUCTURED-CODE'),
      },
    });

    expect(context).toEqual({ navigation: { qurl: '[redacted]' } });
    expect(JSON.stringify(context)).not.toContain('STRUCTURED-CODE');
  });

  it('bounds collection breadth and nesting depth', () => {
    const context = sanitizeLogContext({
      values: Array.from({ length: 1_000 }, (_, index) => `value-${index}`),
      deep: {
        a: {
          b: {
            c: {
              d: {
                e: {
                  f: {
                    g: { value: 'DEEP-SECRET' },
                  },
                },
              },
            },
          },
        },
      },
    });
    const values = (context.values ?? []) as unknown[];

    expect(values).toHaveLength(101);
    expect(values.at(-1)).toBe('[truncated]');
    expect(JSON.stringify(context)).not.toContain('DEEP-SECRET');
  });

  it('sanitizes url and href values instead of dropping them', () => {
    const { raw, parsed } = captureLog({
      url: 'https://u:p@example.com/x?token=leak',
      nested: { href: 'https://example.com/y?session=leak2' },
    });
    expect(raw).not.toContain('leak');
    expect(raw).not.toContain('u:p@');
    expect(parsed.url).toContain('example.com/x');
    expect(parsed.url).toContain('token=%5Bredacted%5D');
    expect((parsed.nested as Record<string, unknown>).href).toContain('session=%5Bredacted%5D');
  });

  it('preserves the message and non-sensitive context', () => {
    const { parsed } = captureLog({ provider: 'demo', requestId: 'req-1', durationMs: 42 }, 'fetch done');
    expect(parsed.msg).toBe('fetch done');
    expect(parsed.provider).toBe('demo');
    expect(parsed.requestId).toBe('req-1');
    expect(parsed.durationMs).toBe(42);
  });
});

describe('free-text log sanitization', () => {
  it('removes credentials and query tokens embedded in error messages and stacks', () => {
    const secretUrl = 'https://alice:pw@example.invalid/x?token=super-secret';
    const out = sanitizeLogText(`request failed at ${secretUrl} password=hunter2 Bearer abc.def`);
    expect(out).not.toContain('alice');
    expect(out).not.toContain('pw');
    expect(out).not.toContain('super-secret');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('abc.def');
  });

  it('rescans non-sensitive URL syntax for nested sensitive assignments', () => {
    const out = sanitizeLogText('GET https://example.test/?token=URL-SECRET failed');

    expect(out).toContain('token=[redacted]');
    expect(out).not.toContain('URL-SECRET');
  });

  it('redacts complete quoted secrets containing escaped quote characters', () => {
    const out = sanitizeLogText(String.raw`login password="prefix\"SECRET-SUFFIX" failed`);

    expect(out).toBe('login password=[redacted] failed');
    expect(out).not.toContain('SECRET-SUFFIX');
  });

  it('sanitizes nested errors and secrets at arbitrary context depth', () => {
    const context = sanitizeLogContext({
      nested: {
        deeper: {
          password: 'hidden',
          error: new Error('failed https://u:p@example.invalid/?token=hidden-too'),
        },
      },
    });
    expect(JSON.stringify(context)).not.toContain('hidden');
    expect(JSON.stringify(context)).not.toContain('u:p@');
  });

  it('bounds oversized free text after sanitizing the retained diagnostic prefix', () => {
    const nested = encodeURIComponent('https://u:p@example.invalid/cb?code=PREFIX-CODE');
    const out = sanitizeLogText(
      `failed https://login.example/?qurl=${nested} ${'x'.repeat(100_000)}`,
    );

    expect(out).not.toContain('PREFIX-CODE');
    expect(out).not.toContain('u:p@');
    expect(out).toContain('[truncated]');
    expect(out.length).toBeLessThan(33_000);
  });
});
