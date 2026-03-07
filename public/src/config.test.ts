import { describe, it, expect } from 'vitest';
import { getLogLevel } from './config.js';

describe('Config', () => {
  it('should return a valid log level', () => {
    const level = getLogLevel();
    expect(['debug', 'info', 'warn', 'error']).toContain(level);
  });
});
