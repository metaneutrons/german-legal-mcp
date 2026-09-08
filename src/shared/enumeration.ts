/**
 * Cursor handling for providers that fan out across several sources.
 *
 * A walk visits one source at a time, so the token has to record which source
 * is in progress as well as where inside it. Kept opaque: it is a resume
 * token, not an offset a caller should compute or reason about.
 */
export interface EnumerationCursor {
  readonly source: string;
  readonly cursor?: string;
}

export function encodeEnumerationCursor(value: EnumerationCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** `undefined` for anything unreadable; callers reject rather than restart. */
export function decodeEnumerationCursor(token: string): EnumerationCursor | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { source, cursor } = parsed as Partial<EnumerationCursor>;
    return typeof source === 'string' ? { source, ...(cursor ? { cursor } : {}) } : undefined;
  } catch {
    return undefined;
  }
}
