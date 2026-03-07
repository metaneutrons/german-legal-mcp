import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RisProvider } from './index.js';

describe('RisProvider', () => {
  let provider: RisProvider;

  beforeEach(() => {
    provider = new RisProvider();
  });

  describe('getTools', () => {
    it('returns 6 tools', () => {
      const tools = provider.getTools();
      expect(tools).toHaveLength(6);
    });

    it('all tools have ris: prefix', () => {
      const tools = provider.getTools();
      tools.forEach(tool => {
        expect(tool.name).toMatch(/^ris:/);
      });
    });

    it('includes expected tool names', () => {
      const tools = provider.getTools();
      const names = tools.map(t => t.name);
      expect(names).toContain('ris:search');
      expect(names).toContain('ris:get_document');
      expect(names).toContain('ris:get_legislation');
      expect(names).toContain('ris:get_caselaw');
      expect(names).toContain('ris:list_courts');
      expect(names).toContain('ris:get_statistics');
    });
  });

  describe('handleToolCall - input validation', () => {
    it('returns error for unknown tool', async () => {
      const result = await provider.handleToolCall('ris:unknown', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not implemented');
    });

    it('returns error for ris:search without query', async () => {
      const result = await provider.handleToolCall('ris:search', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('query');
      expect(result.content[0].text).toContain('required');
    });

    it('returns error for ris:search with non-string query', async () => {
      const result = await provider.handleToolCall('ris:search', { query: 123 });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('query');
    });

    it('returns error for ris:get_document without id', async () => {
      const result = await provider.handleToolCall('ris:get_document', { documentType: 'legislation' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('id');
      expect(result.content[0].text).toContain('required');
    });

    it('returns error for ris:get_document without documentType', async () => {
      const result = await provider.handleToolCall('ris:get_document', { id: 'test' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('documentType');
      expect(result.content[0].text).toContain('required');
    });
  });

  describe('handleToolCall - error handling', () => {
    it('catches and returns HTTP errors', async () => {
      // Mock axios to throw error
      const mockClient = {
        get: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (provider as any).client = mockClient;

      const result = await provider.handleToolCall('ris:search', { query: 'test' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('shutdown', () => {
    it('completes without error', async () => {
      await expect(provider.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('Provider interface compliance', () => {
    it('has required name property', () => {
      expect(provider.name).toBe('ris');
    });

    it('getTools returns array', () => {
      const tools = provider.getTools();
      expect(Array.isArray(tools)).toBe(true);
    });

    it('handleToolCall returns Promise<ToolResult>', async () => {
      const result = await provider.handleToolCall('ris:unknown', {});
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('isError');
      expect(Array.isArray(result.content)).toBe(true);
    });

    it('shutdown returns Promise<void>', async () => {
      const result = provider.shutdown();
      expect(result).toBeInstanceOf(Promise);
      await result;
    });
  });
});
