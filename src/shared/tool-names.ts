/**
 * Tool-name subset supported by Claude's tool API and therefore by Claude
 * Desktop connectors. MCP itself also permits dots and names up to 128
 * characters, but advertising that broader shape makes otherwise valid MCP
 * tools disappear from Claude.
 */
export const PORTABLE_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const CANONICAL_TOOL_NAME_PATTERN = /^[a-z][a-z0-9-]*_[a-z][a-z0-9_]*$/;
export const LEGACY_TOOL_NAME_PATTERN = /^[a-z][a-z0-9-]*:[a-z][a-z0-9_]*$/;

export function isPortableToolName(name: string): boolean {
  return PORTABLE_TOOL_NAME_PATTERN.test(name);
}

/** Project-level grammar: lowercase `provider_operation` within the portable subset. */
export function isCanonicalToolName(name: string, provider?: string): boolean {
  if (!isPortableToolName(name) || !CANONICAL_TOOL_NAME_PATTERN.test(name)) return false;
  if (provider === undefined) return true;
  return name.slice(0, name.indexOf('_')) === provider;
}

export function isLegacyToolName(name: string): boolean {
  return LEGACY_TOOL_NAME_PATTERN.test(name);
}

/**
 * Keep pre-3.4.5 `provider:operation` calls working without advertising the
 * incompatible spelling through tools/list. Compact document references that
 * contain a path do not match this deliberately narrow legacy shape.
 */
export function normalizeToolName(name: string): string {
  if (!isLegacyToolName(name)) return name;
  const separator = name.indexOf(':');
  return `${name.slice(0, separator)}_${name.slice(separator + 1)}`;
}
