import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ConfigurationError,
  ENVIRONMENT_VARIABLES,
  readBooleanEnv,
  readEnumEnv,
  readIntegerEnv,
  getLogLevel,
  readStringEnv,
  readUrlEnv,
  redactEnvironment,
} from './config.js';

describe('configuration environment parsing', () => {
  it('parses typed values and defaults', () => {
    expect(readBooleanEnv('FLAG', true, {})).toBe(true);
    expect(readBooleanEnv('FLAG', false, { FLAG: 'true' })).toBe(true);
    expect(readIntegerEnv('COUNT', 3, { min: 0 }, { COUNT: '12' })).toBe(12);
    expect(readEnumEnv('MODE', ['a', 'b'] as const, 'a', { MODE: 'b' })).toBe('b');
    expect(readUrlEnv('URL', { URL: 'https://example.com/path' }))
      .toBe('https://example.com/path');
  });

  it('treats an unsubstituted ${user_config.x} placeholder as unset', () => {
    // Claude Desktop passes the literal placeholder for an empty optional field.
    expect(readStringEnv('X', { X: '${user_config.api_secret}' })).toBeUndefined();
    expect(readStringEnv('X', { X: '  ${user_config.foo}  ' })).toBeUndefined();
    // A real value that merely contains such text is still honoured.
    expect(readStringEnv('X', { X: 'prefix ${x}' })).toBe('prefix ${x}');
    expect(readStringEnv('X', { X: 'realuser' })).toBe('realuser');
    // readUrlEnv builds on readStringEnv, so a bare placeholder no longer throws.
    expect(readUrlEnv('URL', { URL: '${user_config.login_endpoint}' })).toBeUndefined();
  });

  it('rejects malformed values without terminating the process', () => {
    expect(() => readBooleanEnv('FLAG', true, { FLAG: 'yes' }))
      .toThrow(ConfigurationError);
    expect(() => readIntegerEnv('COUNT', 1, { min: 0 }, { COUNT: '-1' }))
      .toThrow('COUNT must be at least 0');
    expect(() => readUrlEnv('URL', { URL: 'not a url' }))
      .toThrow(ConfigurationError);
  });

  it('accepts only supported structured log levels', () => {
    expect(getLogLevel({ GLMCP_LOG_LEVEL: 'debug' })).toBe('debug');
    expect(getLogLevel({ LOG_LEVEL: 'warn' })).toBe('warn');
    expect(() => getLogLevel({ GLMCP_LOG_LEVEL: 'verbose' }))
      .toThrow('GLMCP_LOG_LEVEL must be one of');
  });

  it('redacts catalogued secrets', () => {
    expect(redactEnvironment({
      GLMCP_DIP_API_KEY: 'k-123',
      GLMCP_NAUTOS_PASSWORD: 'secret',
      GLMCP_LOG_LEVEL: 'info',
    })).toEqual({
      GLMCP_DIP_API_KEY: '[REDACTED]',
      GLMCP_NAUTOS_PASSWORD: '[REDACTED]',
      GLMCP_LOG_LEVEL: 'info',
    });
  });

  it('contains each environment variable only once', () => {
    const names = ENVIRONMENT_VARIABLES.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps the README environment-variable catalogue complete', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf-8');
    for (const { name } of ENVIRONMENT_VARIABLES) {
      expect(readme, `${name} is missing from README.md`).toContain(`\`${name}\``);
    }
  });

  it('documents each catalogued default in its README row (docs SSOT)', () => {
    const lines = readFileSync(join(process.cwd(), 'README.md'), 'utf-8').split('\n');
    for (const { name, defaultValue } of ENVIRONMENT_VARIABLES) {
      if (defaultValue === undefined) continue;
      const row = lines.find((line) => line.includes(`\`${name}\``));
      expect(row, `${name} has no README row`).toBeDefined();
      expect(row, `${name} README row must state its default \`${defaultValue}\``)
        .toContain(`\`${defaultValue}\``);
    }
  });
});
