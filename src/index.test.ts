import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { z } from 'zod';
import { Provider, ToolDefinition, ToolResult } from './shared/types.js';
import { BeckProvider } from './providers/beck/index.js';
import { RisProvider } from './providers/ris/index.js';

/**
 * Mock provider factory for testing orchestrator behavior.
 * Creates providers with configurable tools for property testing.
 */
function createMockProvider(
  name: string,
  tools: ToolDefinition[],
  handleToolCallFn?: (toolName: string, args: Record<string, unknown>) => Promise<ToolResult>
): Provider {
  return {
    name,
    getTools: () => tools,
    handleToolCall: handleToolCallFn || (async (toolName) => ({
      content: [{ type: 'text', text: `Handled ${toolName}` }],
    })),
    shutdown: async () => {},
  };
}

/**
 * Orchestrator class for testing.
 * Mirrors the logic in index.ts but is testable in isolation.
 */
class TestOrchestrator {
  private providers: Map<string, Provider> = new Map();

  async registerProvider(provider: Provider): Promise<void> {
    this.providers.set(provider.name, provider);
    if (provider.initialize) {
      await provider.initialize();
    }
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.providers.values()).flatMap((p) => p.getTools());
  }

  async handleToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const colonIndex = toolName.indexOf(':');
    if (colonIndex === -1) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }

    const prefix = toolName.substring(0, colonIndex);
    const provider = this.providers.get(prefix);

    if (!provider) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }

    return provider.handleToolCall(toolName, args);
  }

  async shutdownAllProviders(): Promise<void> {
    for (const provider of this.providers.values()) {
      await provider.shutdown();
    }
  }

  getProviderCount(): number {
    return this.providers.size;
  }
}

describe('Orchestrator', () => {
  describe('Property 4: Tool Aggregation', () => {
    /**
     * Property 4: Tool Aggregation
     * For any set of registered providers, the orchestrator's getAllTools()
     * SHALL return an array containing exactly the union of all tools
     * returned by each provider's getTools().
     *
     * **Validates: Requirements 4.2, 6.2**
     */
    it('getAllTools returns union of all provider tools', async () => {
      // Generate provider configurations
      const providerConfigArb = fc.array(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z]+$/.test(s)),
          toolCount: fc.integer({ min: 0, max: 5 }),
        }),
        { minLength: 1, maxLength: 5 }
      ).filter(configs => {
        // Ensure unique provider names
        const names = configs.map(c => c.name);
        return new Set(names).size === names.length;
      });

      await fc.assert(
        fc.asyncProperty(providerConfigArb, async (configs) => {
          const orchestrator = new TestOrchestrator();
          let expectedTotalTools = 0;

          for (const config of configs) {
            const tools: ToolDefinition[] = [];
            for (let i = 0; i < config.toolCount; i++) {
              tools.push({
                name: `${config.name}:tool${i}`,
                description: `Tool ${i} for ${config.name}`,
                inputSchema: z.object({}),
              });
            }
            expectedTotalTools += tools.length;

            const provider = createMockProvider(config.name, tools);
            await orchestrator.registerProvider(provider);
          }

          const allTools = orchestrator.getAllTools();
          
          // Verify total count matches
          return allTools.length === expectedTotalTools;
        }),
        { numRuns: 100 }
      );
    });

    it('getAllTools contains all tools from each provider', async () => {
      // Generate specific tool names to verify they all appear
      const providerToolsArb = fc.array(
        fc.record({
          name: fc.constantFrom('alpha', 'beta', 'gamma'),
          toolNames: fc.array(
            fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z]+$/.test(s)),
            { minLength: 0, maxLength: 3 }
          ),
        }),
        { minLength: 1, maxLength: 3 }
      ).filter(configs => {
        const names = configs.map(c => c.name);
        return new Set(names).size === names.length;
      });

      await fc.assert(
        fc.asyncProperty(providerToolsArb, async (configs) => {
          const orchestrator = new TestOrchestrator();
          const expectedToolNames: string[] = [];

          for (const config of configs) {
            const tools: ToolDefinition[] = config.toolNames.map(toolName => ({
              name: `${config.name}:${toolName}`,
              description: `Description for ${toolName}`,
              inputSchema: z.object({}),
            }));
            expectedToolNames.push(...tools.map(t => t.name));

            const provider = createMockProvider(config.name, tools);
            await orchestrator.registerProvider(provider);
          }

          const allTools = orchestrator.getAllTools();
          const actualToolNames = allTools.map(t => t.name);

          // Every expected tool should be present
          return expectedToolNames.every(name => actualToolNames.includes(name));
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 5: Tool Routing by Prefix', () => {
    /**
     * Property 5: Tool Routing by Prefix
     * For any tool call with name in format {prefix}:{action},
     * the orchestrator SHALL route the call to the provider whose name equals {prefix}.
     *
     * **Validates: Requirements 4.3, 5.2**
     */
    it('routes tool calls to correct provider based on prefix', async () => {
      const providerNamesArb = fc.array(
        fc.constantFrom('beck', 'ris', 'gii', 'test'),
        { minLength: 2, maxLength: 4 }
      ).filter(names => new Set(names).size === names.length);

      await fc.assert(
        fc.asyncProperty(providerNamesArb, async (providerNames) => {
          const orchestrator = new TestOrchestrator();
          const callLog: string[] = [];

          // Register providers that log which one was called
          for (const name of providerNames) {
            const provider = createMockProvider(
              name,
              [{ name: `${name}:action`, description: 'Test', inputSchema: z.object({}) }],
              async (_toolName) => {
                callLog.push(name);
                return { content: [{ type: 'text', text: `Called ${name}` }] };
              }
            );
            await orchestrator.registerProvider(provider);
          }

          // Call each provider's tool and verify routing
          for (const name of providerNames) {
            callLog.length = 0; // Clear log
            await orchestrator.handleToolCall(`${name}:action`, {});
            
            // Verify only the correct provider was called
            if (callLog.length !== 1 || callLog[0] !== name) {
              return false;
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('passes correct toolName and args to provider', async () => {
      const toolCallArb = fc.record({
        prefix: fc.constantFrom('beck', 'ris', 'test'),
        action: fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z_]+$/.test(s)),
        args: fc.dictionary(
          fc.string({ minLength: 1, maxLength: 5 }).filter(s => /^[a-z]+$/.test(s)),
          fc.oneof(fc.string(), fc.integer(), fc.boolean())
        ),
      });

      await fc.assert(
        fc.asyncProperty(toolCallArb, async ({ prefix, action, args }) => {
          const orchestrator = new TestOrchestrator();
          let receivedToolName: string | null = null;
          let receivedArgs: Record<string, unknown> | null = null;

          const provider = createMockProvider(
            prefix,
            [{ name: `${prefix}:${action}`, description: 'Test', inputSchema: z.object({}) }],
            async (toolName, toolArgs) => {
              receivedToolName = toolName;
              receivedArgs = toolArgs;
              return { content: [{ type: 'text', text: 'OK' }] };
            }
          );
          await orchestrator.registerProvider(provider);

          const fullToolName = `${prefix}:${action}`;
          await orchestrator.handleToolCall(fullToolName, args);

          // Verify correct values were passed
          return receivedToolName === fullToolName && 
                 JSON.stringify(receivedArgs) === JSON.stringify(args);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 6: Unknown Prefix Error Handling', () => {
    /**
     * Property 6: Unknown Prefix Error Handling
     * For any tool call with a prefix that does not match any registered provider's name,
     * the orchestrator SHALL return a ToolResult with isError: true
     * and a message indicating the tool is unknown.
     *
     * **Validates: Requirements 5.3**
     */
    it('returns isError: true for unknown prefix', async () => {
      const unknownPrefixArb = fc.record({
        registeredPrefixes: fc.array(
          fc.constantFrom('beck', 'ris'),
          { minLength: 0, maxLength: 2 }
        ).filter(names => new Set(names).size === names.length),
        unknownPrefix: fc.constantFrom('unknown', 'invalid', 'fake', 'xyz'),
        action: fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z]+$/.test(s)),
      });

      await fc.assert(
        fc.asyncProperty(unknownPrefixArb, async ({ registeredPrefixes, unknownPrefix, action }) => {
          const orchestrator = new TestOrchestrator();

          // Register only the known providers
          for (const prefix of registeredPrefixes) {
            const provider = createMockProvider(
              prefix,
              [{ name: `${prefix}:tool`, description: 'Test', inputSchema: z.object({}) }]
            );
            await orchestrator.registerProvider(provider);
          }

          // Call with unknown prefix
          const result = await orchestrator.handleToolCall(`${unknownPrefix}:${action}`, {});

          // Must have isError: true
          return result.isError === true;
        }),
        { numRuns: 100 }
      );
    });

    it('returns error message containing tool name for unknown prefix', async () => {
      const unknownToolArb = fc.record({
        unknownPrefix: fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z]+$/.test(s)),
        action: fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z]+$/.test(s)),
      });

      await fc.assert(
        fc.asyncProperty(unknownToolArb, async ({ unknownPrefix, action }) => {
          const orchestrator = new TestOrchestrator();
          // No providers registered

          const toolName = `${unknownPrefix}:${action}`;
          const result = await orchestrator.handleToolCall(toolName, {});

          // Error message should contain the tool name
          const hasErrorMessage = result.content.some(
            c => c.type === 'text' && c.text.includes(toolName)
          );

          return result.isError === true && hasErrorMessage;
        }),
        { numRuns: 100 }
      );
    });

    it('returns isError: true for tool names without colon', async () => {
      const noColonToolArb = fc.string({ minLength: 1, maxLength: 20 })
        .filter(s => !s.includes(':') && /^[a-z]+$/.test(s));

      await fc.assert(
        fc.asyncProperty(noColonToolArb, async (toolName) => {
          const orchestrator = new TestOrchestrator();
          
          // Register a provider
          const provider = createMockProvider(
            'test',
            [{ name: 'test:action', description: 'Test', inputSchema: z.object({}) }]
          );
          await orchestrator.registerProvider(provider);

          const result = await orchestrator.handleToolCall(toolName, {});

          return result.isError === true;
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 3: Orchestrator Shutdown Lifecycle', () => {
    /**
     * Property 3: Orchestrator Shutdown Lifecycle
     * For any set of registered providers, when the orchestrator's shutdown is called,
     * it SHALL call shutdown() on every registered provider.
     *
     * **Validates: Requirements 1.7, 4.4**
     */
    it('shutdown calls shutdown() on all registered providers', async () => {
      const providerCountArb = fc.integer({ min: 1, max: 10 });

      await fc.assert(
        fc.asyncProperty(providerCountArb, async (count) => {
          const orchestrator = new TestOrchestrator();
          const shutdownCalls: string[] = [];

          // Register N providers, each tracking shutdown calls
          for (let i = 0; i < count; i++) {
            const providerName = `provider${i}`;
            const provider: Provider = {
              name: providerName,
              getTools: () => [],
              handleToolCall: async () => ({ content: [{ type: 'text', text: 'OK' }] }),
              shutdown: async () => {
                shutdownCalls.push(providerName);
              },
            };
            await orchestrator.registerProvider(provider);
          }

          // Call shutdown
          await orchestrator.shutdownAllProviders();

          // Verify all providers had shutdown called
          return shutdownCalls.length === count;
        }),
        { numRuns: 100 }
      );
    });

    it('shutdown calls shutdown() exactly once per provider', async () => {
      const providerNamesArb = fc.array(
        fc.constantFrom('alpha', 'beta', 'gamma', 'delta', 'epsilon'),
        { minLength: 1, maxLength: 5 }
      ).filter(names => new Set(names).size === names.length);

      await fc.assert(
        fc.asyncProperty(providerNamesArb, async (providerNames) => {
          const orchestrator = new TestOrchestrator();
          const shutdownCounts: Map<string, number> = new Map();

          // Initialize counts
          for (const name of providerNames) {
            shutdownCounts.set(name, 0);
          }

          // Register providers that count shutdown calls
          for (const name of providerNames) {
            const provider: Provider = {
              name,
              getTools: () => [],
              handleToolCall: async () => ({ content: [{ type: 'text', text: 'OK' }] }),
              shutdown: async () => {
                shutdownCounts.set(name, (shutdownCounts.get(name) || 0) + 1);
              },
            };
            await orchestrator.registerProvider(provider);
          }

          // Call shutdown
          await orchestrator.shutdownAllProviders();

          // Verify each provider's shutdown was called exactly once
          for (const name of providerNames) {
            if (shutdownCounts.get(name) !== 1) {
              return false;
            }
          }
          return true;
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 1: Provider Interface Conformance', () => {
    /**
     * Property 1: Provider Interface Conformance
     * For any object implementing the Provider interface, it SHALL have:
     * - a `name` property (string)
     * - a `getTools()` method returning an array of ToolDefinitions
     * - a `handleToolCall()` method returning Promise<ToolResult>
     * - a `shutdown()` method returning Promise<void>
     *
     * **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 3.2, 7.2**
     */
    it('BeckProvider has all required Provider interface members', () => {
      const provider = new BeckProvider();

      // Verify name property exists and is a string
      expect(typeof provider.name).toBe('string');
      expect(provider.name).toBe('beck');

      // Verify getTools method exists and returns an array
      expect(typeof provider.getTools).toBe('function');
      const tools = provider.getTools();
      expect(Array.isArray(tools)).toBe(true);

      // Verify handleToolCall method exists and is a function
      expect(typeof provider.handleToolCall).toBe('function');

      // Verify shutdown method exists and is a function
      expect(typeof provider.shutdown).toBe('function');
    });

    it('RisProvider has all required Provider interface members', () => {
      const provider = new RisProvider();

      // Verify name property exists and is a string
      expect(typeof provider.name).toBe('string');
      expect(provider.name).toBe('ris');

      // Verify getTools method exists and returns an array
      expect(typeof provider.getTools).toBe('function');
      const tools = provider.getTools();
      expect(Array.isArray(tools)).toBe(true);

      // Verify handleToolCall method exists and is a function
      expect(typeof provider.handleToolCall).toBe('function');

      // Verify shutdown method exists and is a function
      expect(typeof provider.shutdown).toBe('function');
    });

    it('BeckProvider.handleToolCall returns Promise<ToolResult>', async () => {
      const provider = new BeckProvider();
      
      // Call with any tool name - should return a ToolResult
      const result = await provider.handleToolCall('beck:unknown', {});
      
      // Verify result structure
      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
    });

    it('RisProvider.handleToolCall returns Promise<ToolResult>', async () => {
      const provider = new RisProvider();
      
      // Call with any tool name - should return a ToolResult
      const result = await provider.handleToolCall('ris:unknown', {});
      
      // Verify result structure
      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
    });

    it('BeckProvider.shutdown returns Promise<void>', async () => {
      const provider = new BeckProvider();
      
      // shutdown should return a Promise that resolves to undefined
      const result = await provider.shutdown();
      expect(result).toBeUndefined();
    });

    it('RisProvider.shutdown returns Promise<void>', async () => {
      const provider = new RisProvider();
      
      // shutdown should return a Promise that resolves to undefined
      const result = await provider.shutdown();
      expect(result).toBeUndefined();
    });

    it('all providers conform to Provider interface via property test', async () => {
      // Property test: for any provider from our list, verify interface conformance
      const providerArb = fc.constantFrom(
        () => new BeckProvider(),
        () => new RisProvider()
      );

      await fc.assert(
        fc.asyncProperty(providerArb, async (createProvider) => {
          const provider = createProvider();

          // 1. name is a non-empty string
          if (typeof provider.name !== 'string' || provider.name.length === 0) {
            return false;
          }

          // 2. getTools returns an array
          if (typeof provider.getTools !== 'function') {
            return false;
          }
          const tools = provider.getTools();
          if (!Array.isArray(tools)) {
            return false;
          }

          // 3. handleToolCall is a function that returns a Promise
          if (typeof provider.handleToolCall !== 'function') {
            return false;
          }
          const result = await provider.handleToolCall(`${provider.name}:test`, {});
          if (!result || !Array.isArray(result.content)) {
            return false;
          }

          // 4. shutdown is a function that returns a Promise
          if (typeof provider.shutdown !== 'function') {
            return false;
          }
          const shutdownResult = await provider.shutdown();
          if (shutdownResult !== undefined) {
            return false;
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 11: Error Response Structure', () => {
    /**
     * Property 11: Error Response Structure
     * For any provider tool call that encounters an error, the returned ToolResult
     * SHALL have isError: true and the content array SHALL contain at least one
     * element with the error message.
     *
     * **Validates: Requirements 10.1, 10.2**
     */
    it('error responses have isError: true', async () => {
      // Test with various error-producing scenarios
      const errorScenarioArb = fc.constantFrom(
        // Unknown tool for Beck provider (when not configured)
        { provider: () => new BeckProvider(), toolName: 'beck:unknown_tool', args: {} },
        // Unknown tool for RIS provider (always returns error - not implemented)
        { provider: () => new RisProvider(), toolName: 'ris:search', args: {} },
        { provider: () => new RisProvider(), toolName: 'ris:get_document', args: {} },
      );

      await fc.assert(
        fc.asyncProperty(errorScenarioArb, async (scenario) => {
          const provider = scenario.provider();
          const result = await provider.handleToolCall(scenario.toolName, scenario.args);

          // Error responses must have isError: true
          return result.isError === true;
        }),
        { numRuns: 100 }
      );
    });

    it('error responses contain message in content array', async () => {
      const errorScenarioArb = fc.constantFrom(
        { provider: () => new BeckProvider(), toolName: 'beck:unknown_tool', args: {} },
        { provider: () => new RisProvider(), toolName: 'ris:search', args: {} },
        { provider: () => new RisProvider(), toolName: 'ris:get_document', args: {} },
      );

      await fc.assert(
        fc.asyncProperty(errorScenarioArb, async (scenario) => {
          const provider = scenario.provider();
          const result = await provider.handleToolCall(scenario.toolName, scenario.args);

          // Content array must exist and have at least one element
          if (!Array.isArray(result.content) || result.content.length === 0) {
            return false;
          }

          // At least one content element must have type 'text' and non-empty text
          const hasTextContent = result.content.some(
            c => c.type === 'text' && typeof c.text === 'string' && c.text.length > 0
          );

          return hasTextContent;
        }),
        { numRuns: 100 }
      );
    });

    it('orchestrator returns proper error structure for unknown tools', async () => {
      const unknownToolArb = fc.record({
        prefix: fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z]+$/.test(s)),
        action: fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z]+$/.test(s)),
      });

      await fc.assert(
        fc.asyncProperty(unknownToolArb, async ({ prefix, action }) => {
          const orchestrator = new TestOrchestrator();
          // No providers registered - any tool call should error

          const toolName = `${prefix}:${action}`;
          const result = await orchestrator.handleToolCall(toolName, {});

          // Must have isError: true
          if (result.isError !== true) {
            return false;
          }

          // Must have content array with at least one text element
          if (!Array.isArray(result.content) || result.content.length === 0) {
            return false;
          }

          const hasTextContent = result.content.some(
            c => c.type === 'text' && typeof c.text === 'string' && c.text.length > 0
          );

          return hasTextContent;
        }),
        { numRuns: 100 }
      );
    });

    it('RisProvider always returns error with proper structure (not implemented)', async () => {
      const toolNameArb = fc.string({ minLength: 1, maxLength: 20 })
        .filter(s => /^[a-z_]+$/.test(s));

      await fc.assert(
        fc.asyncProperty(toolNameArb, async (action) => {
          const provider = new RisProvider();
          const result = await provider.handleToolCall(`ris:${action}`, {});

          // RIS is not implemented, so all calls should return error
          if (result.isError !== true) {
            return false;
          }

          // Content must contain error message
          if (!Array.isArray(result.content) || result.content.length === 0) {
            return false;
          }

          const hasErrorMessage = result.content.some(
            c => c.type === 'text' && c.text.includes('not implemented')
          );

          return hasErrorMessage;
        }),
        { numRuns: 100 }
      );
    });
  });
});
