import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ToolDefinition, ToolResult } from './shared/types.js';
import { riiTools } from './providers/rii/tools/index.js';
import {
  isCanonicalToolName,
  normalizeToolName,
} from './shared/tool-names.js';
import {
  looksLikeToolInvocation,
  parseToolArgs,
  runCli,
  type CliRegistry,
} from './cli.js';

function fixtureTool(overrides: Partial<{
  properties: Record<string, unknown>;
  required: string[];
}> = {}): ToolDefinition {
  return {
    name: 'fixture_run',
    description: 'A fixture tool for CLI tests.',
    inputSchema: {
      toJSONSchema: () => ({
        properties: overrides.properties ?? {
          query: { type: 'string', description: 'What to look for.' },
          limit: { type: 'number', default: 10, description: 'How many.' },
        },
        required: overrides.required ?? ['query'],
      }),
    } as ToolDefinition['inputSchema'],
  };
}

function fixtureRegistry(
  tools: ToolDefinition[],
  handleToolCall: CliRegistry['handleToolCall'],
): CliRegistry {
  return { getTools: () => tools, handleToolCall };
}

describe('looksLikeToolInvocation', () => {
  it('accepts the canonical provider_tool shape', () => {
    expect(looksLikeToolInvocation(['rii_search', '--query', 'x'])).toBe(true);
  });

  it('continues to recognize the legacy provider:tool CLI shape', () => {
    expect(looksLikeToolInvocation(['rii:search', '--query', 'x'])).toBe(true);
  });

  it('rejects flags, empty argv and plain words', () => {
    expect(looksLikeToolInvocation(['--help'])).toBe(false);
    expect(looksLikeToolInvocation([])).toBe(false);
    expect(looksLikeToolInvocation(['search'])).toBe(false);
    expect(looksLikeToolInvocation(['RII_search'])).toBe(false);
    expect(looksLikeToolInvocation(['rii_do-stuff'])).toBe(false);
    expect(looksLikeToolInvocation(['rii__search'])).toBe(false);
  });
});

describe('tool-name compatibility', () => {
  it('normalizes only the narrow legacy provider:operation shape', () => {
    expect(normalizeToolName('rii:search')).toBe('rii_search');
    expect(normalizeToolName('source:document/path')).toBe('source:document/path');
    expect(normalizeToolName('test:tool-names')).toBe('test:tool-names');
  });

  it('uses one strict canonical grammar for new names', () => {
    expect(isCanonicalToolName('dip_search_plenarprotokoll', 'dip')).toBe(true);
    expect(isCanonicalToolName('dip_search_plenarprotokoll', 'rii')).toBe(false);
    expect(isCanonicalToolName('dip_do-stuff', 'dip')).toBe(false);
  });
});

describe('parseToolArgs', () => {
  const schema = {
    properties: {
      query: { type: 'string' },
      limit: { type: 'number' },
      include_snippets: { type: 'boolean' },
      source: { type: 'string', enum: ['BUND', 'ALL'] },
      vpaths: { type: 'array', items: { type: 'string' } },
    },
    required: ['query'],
  };

  it('coerces each declared type', () => {
    const { values, errors } = parseToolArgs(
      ['--query', 'DSGVO', '--limit', '5', '--source', 'ALL'],
      schema,
    );
    expect(errors).toEqual([]);
    expect(values).toEqual({ query: 'DSGVO', limit: 5, source: 'ALL' });
  });

  it('accepts a bare boolean flag as true', () => {
    // No explicit value, and the next token is another flag — presence alone
    // must mean true, the same as omitting a false MCP boolean argument
    // would not.
    const { values, errors } = parseToolArgs(
      ['--include_snippets', '--query', 'x'],
      schema,
    );
    expect(errors).toEqual([]);
    expect(values.include_snippets).toBe(true);
  });

  it('accepts --flag=value and kebab-case flags', () => {
    const { values, errors } = parseToolArgs(
      ['--include-snippets=false', '--query=x'],
      schema,
    );
    expect(errors).toEqual([]);
    expect(values).toEqual({ include_snippets: false, query: 'x' });
  });

  it('splits an array field on commas', () => {
    const { values } = parseToolArgs(['--vpaths', 'a,b, c'], schema);
    expect(values.vpaths).toEqual(['a', 'b', 'c']);
  });

  it('rejects a value outside the declared enum', () => {
    const { errors } = parseToolArgs(['--source', 'BOGUS'], schema);
    expect(errors).toEqual([
      '--source must be one of: BUND, ALL (got "BOGUS")',
    ]);
  });

  it('rejects a non-numeric value for a number field', () => {
    const { errors } = parseToolArgs(['--limit', 'abc'], schema);
    expect(errors).toEqual(['--limit expects a number, got "abc"']);
  });

  it('reports an unknown flag rather than silently dropping it', () => {
    const { errors } = parseToolArgs(['--nonexistent', 'x'], schema);
    expect(errors).toEqual(['Unknown option --nonexistent']);
  });

  it('reports a flag missing its value instead of consuming the next flag as one', () => {
    const { errors } = parseToolArgs(['--query'], schema);
    expect(errors).toEqual(['--query requires a value']);
  });

  it('matches the real rii_search schema end to end', () => {
    // Ground truth against the actual tool this feature exists to serve,
    // not a hand-written stand-in for zod's toJSONSchema() output.
    const schema = (riiTools[0]!.inputSchema as { toJSONSchema: () => any }).toJSONSchema();
    const { values, errors } = parseToolArgs(
      ['--query', 'Schadensersatz', '--limit', '3', '--source', 'ALL', '--collapse_duplicates=false'],
      schema,
    );
    expect(errors).toEqual([]);
    expect(values).toEqual({
      query: 'Schadensersatz',
      limit: 3,
      source: 'ALL',
      collapse_duplicates: false,
    });
  });
});

describe('runCli', () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the result and exits 0 on success', async () => {
    const handleToolCall = vi.fn(async (): Promise<ToolResult> => ({
      content: [{ type: 'text', text: 'ok result' }],
    }));
    const registry = fixtureRegistry([fixtureTool()], handleToolCall);

    const code = await runCli(['fixture_run', '--query', 'x'], registry);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('ok result');
    expect(handleToolCall).toHaveBeenCalledWith('fixture_run', { query: 'x' });
  });

  it('exits 1 and still prints content when the tool reports isError', async () => {
    const registry = fixtureRegistry([fixtureTool()], async () => ({
      content: [{ type: 'text', text: 'something went wrong' }],
      isError: true,
    }));

    const code = await runCli(['fixture_run', '--query', 'x'], registry);

    expect(code).toBe(1);
    expect(stdout.join('')).toContain('something went wrong');
  });

  it('exits 1 and writes to stderr when the tool rejects', async () => {
    const registry = fixtureRegistry([fixtureTool()], async () => {
      throw new Error('socket hang up');
    });

    const code = await runCli(['fixture_run', '--query', 'x'], registry);

    expect(code).toBe(1);
    expect(stderr.join('')).toContain('socket hang up');
    expect(stdout.join('')).toBe('');
  });

  it('never calls the tool for --help, and prints its options instead', async () => {
    const handleToolCall = vi.fn();
    const registry = fixtureRegistry([fixtureTool()], handleToolCall);

    const code = await runCli(['fixture_run', '--help'], registry);

    expect(code).toBe(0);
    expect(handleToolCall).not.toHaveBeenCalled();
    expect(stdout.join('')).toContain('--query');
    expect(stdout.join('')).toContain('required');
  });

  it('shows a defaulted field as optional even when the schema lists it as required', async () => {
    // Zod's `.toJSONSchema()` puts every `.optional().default(x)` field in
    // `required` too (ground-truth: verified directly against real rii_search
    // output). Printing "required" next to "default: 10" would tell a CLI
    // user they must pass a flag they can freely omit.
    const registry = fixtureRegistry([fixtureTool({
      properties: {
        query: { type: 'string', description: 'What to look for.' },
        limit: { type: 'number', default: 10, description: 'How many.' },
      },
      required: ['query', 'limit'],
    })], vi.fn());

    const code = await runCli(['fixture_run', '--help'], registry);

    expect(code).toBe(0);
    const out = stdout.join('');
    expect(out).toMatch(/--limit\s+<number>\s+\(optional, default: 10\)/);
  });

  it('rejects an unknown tool without ever calling handleToolCall', async () => {
    const handleToolCall = vi.fn();
    const registry = fixtureRegistry([fixtureTool()], handleToolCall);

    const code = await runCli(['fixture_nope'], registry);

    expect(code).toBe(1);
    expect(handleToolCall).not.toHaveBeenCalled();
    expect(stderr.join('')).toContain('Unknown tool "fixture_nope"');
    // Same-provider tools are suggested ahead of the full list.
    expect(stderr.join('')).toContain('fixture_run');
  });

  it('rejects bad arguments before ever calling handleToolCall', async () => {
    const handleToolCall = vi.fn();
    const registry = fixtureRegistry([fixtureTool()], handleToolCall);

    const code = await runCli(['fixture_run', '--limit', 'not-a-number'], registry);

    expect(code).toBe(1);
    expect(handleToolCall).not.toHaveBeenCalled();
    expect(stderr.join('')).toContain('--limit expects a number');
  });

  it('requires a tool name', async () => {
    const registry = fixtureRegistry([fixtureTool()], vi.fn());
    const code = await runCli([], registry);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('A tool name is required');
  });

  it('normalizes a legacy colon alias before dispatch', async () => {
    const handleToolCall = vi.fn(async (): Promise<ToolResult> => ({
      content: [{ type: 'text', text: 'ok result' }],
    }));
    const registry = fixtureRegistry([fixtureTool()], handleToolCall);

    const code = await runCli(['fixture:run', '--query', 'x'], registry);

    expect(code).toBe(0);
    expect(handleToolCall).toHaveBeenCalledWith('fixture_run', { query: 'x' });
  });
});
