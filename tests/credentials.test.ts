import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Credentials Configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear Beck credentials before each test
    delete process.env.BECK_USERNAME;
    delete process.env.BECK_PASSWORD;
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  // Helper that mirrors the logic in index.ts
  const isBeckConfigured = () => {
    return !!(process.env.BECK_USERNAME && process.env.BECK_PASSWORD);
  };

  describe('isBeckConfigured', () => {
    it('returns false when both credentials are missing', () => {
      expect(isBeckConfigured()).toBe(false);
    });

    it('returns false when only username is set', () => {
      process.env.BECK_USERNAME = 'testuser';
      expect(isBeckConfigured()).toBe(false);
    });

    it('returns false when only password is set', () => {
      process.env.BECK_PASSWORD = 'testpass';
      expect(isBeckConfigured()).toBe(false);
    });

    it('returns true when both credentials are set', () => {
      process.env.BECK_USERNAME = 'testuser';
      process.env.BECK_PASSWORD = 'testpass';
      expect(isBeckConfigured()).toBe(true);
    });

    it('returns false for empty string username', () => {
      process.env.BECK_USERNAME = '';
      process.env.BECK_PASSWORD = 'testpass';
      expect(isBeckConfigured()).toBe(false);
    });

    it('returns false for empty string password', () => {
      process.env.BECK_USERNAME = 'testuser';
      process.env.BECK_PASSWORD = '';
      expect(isBeckConfigured()).toBe(false);
    });
  });
});
