import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { BeckProvider } from './index.js';
import { beckToolDefinitions } from './tools.js';

describe('BeckProvider', () => {
  // Store original env values
  let originalUsername: string | undefined;
  let originalPassword: string | undefined;

  beforeEach(() => {
    // Save original values
    originalUsername = process.env.BECK_USERNAME;
    originalPassword = process.env.BECK_PASSWORD;
  });

  afterEach(() => {
    // Restore original environment
    if (originalUsername !== undefined) {
      process.env.BECK_USERNAME = originalUsername;
    } else {
      delete process.env.BECK_USERNAME;
    }
    if (originalPassword !== undefined) {
      process.env.BECK_PASSWORD = originalPassword;
    } else {
      delete process.env.BECK_PASSWORD;
    }
  });

  describe('Property 10: Credential-Based Tool Visibility', () => {
    /**
     * Property 10: Credential-Based Tool Visibility
     * For any state where Beck credentials (BECK_USERNAME, BECK_PASSWORD) are not set,
     * the Beck provider's getTools() SHALL return an empty array.
     *
     * **Validates: Requirements 3.7, 8.4**
     */
    it('returns empty tools array when credentials are not set', () => {
      // Generate various "missing credential" scenarios
      const missingCredentialScenarios = fc.oneof(
        // Both missing
        fc.constant({ username: undefined as string | undefined, password: undefined as string | undefined }),
        // Username missing
        fc.constant({ username: undefined as string | undefined, password: 'somepassword' }),
        // Password missing
        fc.constant({ username: 'someuser', password: undefined as string | undefined }),
        // Both empty strings
        fc.constant({ username: '', password: '' }),
        // Username empty
        fc.constant({ username: '', password: 'somepassword' }),
        // Password empty
        fc.constant({ username: 'someuser', password: '' })
      );

      fc.assert(
        fc.property(missingCredentialScenarios, (envConfig) => {
          // Clear credentials first
          delete process.env.BECK_USERNAME;
          delete process.env.BECK_PASSWORD;

          // Set the test scenario
          if (envConfig.username !== undefined) {
            process.env.BECK_USERNAME = envConfig.username;
          }
          if (envConfig.password !== undefined) {
            process.env.BECK_PASSWORD = envConfig.password;
          }

          // Create fresh provider instance that reads current env
          const provider = new BeckProvider();
          const tools = provider.getTools();
          
          return tools.length === 0;
        }),
        { numRuns: 100 }
      );
    });

    it('returns non-empty tools array when both credentials are set', () => {
      // Generate valid credential pairs (non-empty strings)
      const validCredentials = fc.record({
        username: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
        password: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
      });

      fc.assert(
        fc.property(validCredentials, ({ username, password }) => {
          // Set valid credentials
          process.env.BECK_USERNAME = username;
          process.env.BECK_PASSWORD = password;

          // Create fresh provider instance that reads current env
          const provider = new BeckProvider();
          const tools = provider.getTools();
          
          // Should return all beck tools
          return tools.length === beckToolDefinitions.length;
        }),
        { numRuns: 100 }
      );
    });
  });
});
