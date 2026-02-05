import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { beckToolDefinitions } from './tools.js';

describe('Beck Tools', () => {
  describe('Property 7: Beck Tool Naming Convention', () => {
    /**
     * Property 7: Beck Tool Naming Convention
     * For any tool definition returned by the Beck provider's getTools(),
     * the tool name SHALL start with the prefix 'beck:'.
     *
     * **Validates: Requirements 5.1**
     */
    it('all Beck tools start with "beck:" prefix', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...beckToolDefinitions),
          (tool) => {
            return tool.name.startsWith('beck:');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all Beck tools have non-empty names after prefix', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...beckToolDefinitions),
          (tool) => {
            const nameAfterPrefix = tool.name.slice('beck:'.length);
            return nameAfterPrefix.length > 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all Beck tools have descriptions', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...beckToolDefinitions),
          (tool) => {
            return typeof tool.description === 'string' && tool.description.length > 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all Beck tools have input schemas', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...beckToolDefinitions),
          (tool) => {
            return tool.inputSchema !== undefined && tool.inputSchema !== null;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
