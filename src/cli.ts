import type { z } from 'zod';
import type { ToolDefinition, ToolResult } from './shared/types.js';
import { formatToolCallError } from './shared/errors.js';
import {
  isCanonicalToolName,
  isLegacyToolName,
  normalizeToolName,
} from './shared/tool-names.js';

/**
 * One-shot command-line access to any registered tool, bypassing the MCP
 * transport entirely. `german-legal-mcp rii_search --query "..." --limit 5`
 * parses argv, calls the exact same `Provider.handleToolCall` an MCP client
 * would reach through JSON-RPC, and prints the same text a chat client would
 * see — nothing here is a second implementation of a tool.
 *
 * The motivation is context, not convenience: an MCP client loads every
 * tool's name, description and full JSON Schema on every turn, unconditionally
 * — a cost that grows with every connector added. A CLI plus a short usage
 * doc costs a model constant context instead: it learns "glmcp exists, glmcp
 * --help lists tools" once, and discovers a specific tool's argument shape
 * on demand via that tool's own --help, the same way this module discovers
 * it — from the tool's Zod schema, converted to JSON Schema.
 */

/** Structurally compatible with `ProviderRegistry`; kept minimal for testing without loading real providers. */
export interface CliRegistry {
  getTools(): ToolDefinition[];
  handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
}

interface JsonSchemaProperty {
  type?: string;
  enum?: readonly unknown[];
  items?: { type?: string };
  description?: string;
  default?: unknown;
}

interface JsonSchemaObject {
  properties?: Record<string, JsonSchemaProperty>;
  required?: readonly string[];
}

function toJsonSchema(tool: ToolDefinition): JsonSchemaObject {
  return (tool.inputSchema as z.ZodTypeAny).toJSONSchema() as JsonSchemaObject;
}

/**
 * Cheap pre-check so plain MCP startup (no argv) and `--help`/`--version`
 * are not slowed down by loading the provider registry. A real tool name is
 * confirmed against the loaded registry inside `runCli`; this only decides
 * whether CLI mode should be entered at all.
 */
export function looksLikeToolInvocation(argv: readonly string[]): boolean {
  const first = argv[0];
  return typeof first === 'string'
    && (isCanonicalToolName(first) || isLegacyToolName(first));
}

/**
 * Turns `--query foo --limit 5 --include_snippets` into a typed object,
 * using the tool's own JSON Schema as the source of truth for each field's
 * type — the same schema an MCP client would have received. This is what
 * keeps a CLI string like "5" from reaching a provider as the string "5"
 * where a real MCP call would have sent the JSON number 5.
 */
export function parseToolArgs(
  rawArgs: readonly string[],
  schema: JsonSchemaObject,
): { values: Record<string, unknown>; errors: string[] } {
  const properties = schema.properties ?? {};
  const values: Record<string, unknown> = {};
  const errors: string[] = [];

  let index = 0;
  while (index < rawArgs.length) {
    const token = rawArgs[index];
    if (!token?.startsWith('--')) {
      errors.push(`Unexpected argument (expected --flag): "${token}"`);
      index++;
      continue;
    }

    const eq = token.indexOf('=');
    const key = (eq === -1 ? token.slice(2) : token.slice(2, eq)).replace(/-/g, '_');
    const property = properties[key];
    if (!property) {
      errors.push(`Unknown option --${key.replace(/_/g, '-')}`);
      index++;
      if (eq === -1 && rawArgs[index + 1] === undefined) index++;
      continue;
    }

    let raw: string;
    if (eq !== -1) {
      raw = token.slice(eq + 1);
      index++;
    } else if (property.type === 'boolean' && (rawArgs[index + 1] === undefined || rawArgs[index + 1]?.startsWith('--'))) {
      // A boolean flag needs no explicit value; its mere presence means true.
      raw = 'true';
      index++;
    } else {
      const next = rawArgs[index + 1];
      if (next === undefined) {
        errors.push(`--${key.replace(/_/g, '-')} requires a value`);
        index++;
        continue;
      }
      raw = next;
      index += 2;
    }

    const coerced = coerce(raw, property, key);
    if (coerced.error) {
      errors.push(coerced.error);
    } else {
      values[key] = coerced.value;
    }
  }

  return { values, errors };
}

function coerce(
  raw: string,
  property: JsonSchemaProperty,
  key: string,
): { value?: unknown; error?: string } {
  const flag = `--${key.replace(/_/g, '-')}`;

  if (property.enum && !property.enum.includes(raw)) {
    return { error: `${flag} must be one of: ${property.enum.join(', ')} (got "${raw}")` };
  }

  switch (property.type) {
    case 'number':
    case 'integer': {
      const n = Number(raw);
      if (Number.isNaN(n)) return { error: `${flag} expects a number, got "${raw}"` };
      return { value: n };
    }
    case 'boolean': {
      if (raw === 'true') return { value: true };
      if (raw === 'false') return { value: false };
      return { error: `${flag} expects true or false, got "${raw}"` };
    }
    case 'array':
      // Every array-typed tool argument today is a list of plain strings;
      // comma-splitting covers that without inventing a repeated-flag
      // syntax for what is currently a single case.
      return { value: raw.split(',').map((part) => part.trim()).filter(Boolean) };
    default:
      return { value: raw };
  }
}

function formatToolHelp(tool: ToolDefinition): string {
  const schema = toJsonSchema(tool);
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const entries = Object.entries(properties);
  const flagWidth = Math.max(...entries.map(([key]) => key.length), 0) + 2;

  const lines = entries.map(([key, property]) => {
    const flag = `--${key.replace(/_/g, '-')}`.padEnd(flagWidth + 2);
    const type = property.enum ? property.enum.join('|') : (property.items ? `${property.type ?? 'array'}` : property.type ?? 'string');
    // Zod's `.toJSONSchema()` puts every `.optional().default(x)` field in
    // `required` too (the *parsed* value is never undefined) — accurate for
    // an MCP client, but "required" printed next to "default: 5" reads as a
    // contradiction to a human. A field with a default is always omittable
    // on the command line, so treat it as optional here regardless.
    const need = required.has(key) && property.default === undefined
      ? 'required'
      : `optional${property.default !== undefined ? `, default: ${JSON.stringify(property.default)}` : ''}`;
    return `  ${flag}<${type}>  (${need})\n      ${property.description ?? ''}`.trimEnd();
  });

  return `${tool.name} — ${tool.description}\n\nOPTIONS:\n${lines.join('\n')}\n`;
}

function formatUnknownTool(tools: readonly ToolDefinition[], attempted: string): string {
  const canonicalName = normalizeToolName(attempted);
  const separator = canonicalName.indexOf('_');
  const prefix = separator === -1 ? canonicalName : canonicalName.slice(0, separator);
  const sameProvider = tools.filter((tool) => tool.name.startsWith(`${prefix}_`));
  const candidates = sameProvider.length > 0 ? sameProvider : tools;
  const heading = sameProvider.length > 0
    ? `Unknown tool "${attempted}". Tools under "${prefix}":`
    : `Unknown tool "${attempted}". Available tools:`;
  return `${heading}\n${candidates.map((tool) => `  ${tool.name}`).join('\n')}\n`;
}

/**
 * Runs one tool invocation and returns the process exit code. Never throws:
 * every failure path — unknown tool, bad arguments, a rejected provider call
 * — is written to the appropriate stream and reflected only in the return
 * code, so the caller can `process.exit(await runCli(...))` uniformly.
 */
export async function runCli(argv: readonly string[], registry: CliRegistry): Promise<number> {
  const [attemptedName, ...rest] = argv;
  if (!attemptedName) {
    process.stderr.write('A tool name is required, e.g. rii_search.\n');
    return 1;
  }

  const toolName = normalizeToolName(attemptedName);
  const tools = registry.getTools();
  const tool = tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    process.stderr.write(formatUnknownTool(tools, attemptedName));
    return 1;
  }

  if (rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write(formatToolHelp(tool));
    return 0;
  }

  const schema = toJsonSchema(tool);
  const { values, errors } = parseToolArgs(rest, schema);
  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n\nRun "${toolName} --help" for the full option list.\n`);
    return 1;
  }

  try {
    const result = await registry.handleToolCall(toolName, values);
    const text = result.content.map((block) => block.text).join('\n\n');
    process.stdout.write(`${text}\n`);
    return result.isError ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${formatToolCallError(error)}\n`);
    return 1;
  }
}
