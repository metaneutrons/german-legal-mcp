import { describe, expect, it } from 'vitest';
import { AuthenticationError, formatToolCallError } from './errors.js';

describe('formatToolCallError', () => {
  it('redacts credentials and SSO query material from structured errors', () => {
    const rendered = formatToolCallError(new AuthenticationError(
      'Login failed at https://idp.example/callback?code=one-time&RelayState=session',
      new Error('Authorization: Bearer secret-token'),
    ));
    expect(rendered).not.toContain('one-time');
    expect(rendered).not.toContain('session');
    expect(rendered).not.toContain('secret-token');
    expect(rendered).toContain('[redacted]');
  });

  it('sanitizes bare error messages too', () => {
    const rendered = formatToolCallError(
      new Error('GET https://example.test/?token=secret failed'),
    );
    expect(rendered).not.toContain('token=secret');
    expect(rendered).toContain('token=[redacted]');
  });
});
