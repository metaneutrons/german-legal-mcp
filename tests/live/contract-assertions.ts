import { expect } from 'vitest';
import type {
  LegalDataProvider,
  LegalResourceDocument,
  LegalResourceReference,
  LegalResourceType,
  LegalSearchRequest,
} from '../../src/contracts/legal-resource.js';
import type {
  LegalTableOfContents,
  LegalTableOfContentsEntry,
  ProviderAuthenticationStatus,
  ProviderOperationalStatus,
} from '../../src/contracts/provider-capabilities.js';

export interface ExpectedLiveContract {
  readonly providerId: string;
  readonly sourceId?: string;
  readonly resourceType: LegalResourceType;
  readonly jurisdiction?: string;
  readonly minimumContentLength?: number;
}

export function liveEnabled(variable: string): boolean {
  return process.env[variable] === '1';
}

/**
 * Run a live contract, but treat the upstream service refusing to talk to the
 * runner as "not verified" rather than as a broken contract.
 *
 * These checks run on a daily schedule from GitHub-hosted runners, and public
 * services throttle cloud IP ranges — arXiv answered a runner with 406 while the
 * exact same request from a workstation returned 200 (three header variants
 * tried). Failing the job for that trains everyone to ignore a red run, which
 * costs far more than the missed verification.
 *
 * Only refusal statuses are tolerated. A 4xx that means "your request is wrong"
 * (400, 404) or any 5xx still fails, because those are real contract breaks.
 */
const REFUSAL_STATUSES = new Set([403, 406, 429]);

export async function tolerateUpstreamRefusal(
  label: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    const status = (error as { status?: number; response?: { status?: number } })?.status
      ?? (error as { response?: { status?: number } })?.response?.status;
    if (status !== undefined && REFUSAL_STATUSES.has(status)) {
       
      console.warn(
        `[live] ${label}: upstream refused the runner (HTTP ${status}) — contract not verified this run`,
      );
      return;
    }
    throw error;
  }
}

export async function verifySearchAndGet<
  TReference extends LegalResourceReference,
>(
  client: LegalDataProvider<TReference>,
  request: LegalSearchRequest,
  expected: ExpectedLiveContract,
): Promise<{
  reference: TReference;
  document: LegalResourceDocument<TReference>;
}> {
  const page = await client.search(request);
  const failures = reportableFailures(page.failures);
  expect(failures, failureMessage(failures)).toEqual([]);
  expect(page.results.length, `No live result for ${expected.providerId}`).toBeGreaterThan(0);
  const reference = page.results[0];
  if (!reference) throw new Error(`No live result for ${expected.providerId}`);
  verifyReference(reference, expected);

  const document = await client.get(reference);
  verifyDocument(document, expected);
  reportLiveContract(expected.providerId, expected.sourceId ?? reference.provenance.sourceId, {
    resourceType: reference.resourceType,
    documentId: reference.provenance.providerDocumentId,
    title: reference.title,
    contentLength: document.content.value.length,
  });
  return { reference, document };
}

export function verifyReference(
  reference: LegalResourceReference,
  expected: ExpectedLiveContract,
): void {
  expect(reference.resourceType).toBe(expected.resourceType);
  expect(reference.title.trim().length).toBeGreaterThan(2);
  expect(reference.provenance.providerId).toBe(expected.providerId);
  expect(reference.provenance.sourceId.trim().length).toBeGreaterThan(0);
  if (expected.sourceId) expect(reference.provenance.sourceId).toBe(expected.sourceId);
  expect(reference.provenance.providerDocumentId.trim().length).toBeGreaterThan(0);
  if (expected.jurisdiction) expect(reference.jurisdiction).toBe(expected.jurisdiction);
  if (reference.provenance.canonicalUrl) {
    expect(() => new URL(reference.provenance.canonicalUrl ?? '')).not.toThrow();
    expect(reference.provenance.canonicalUrl).toMatch(/^https?:\/\//);
  }
  expect(['public', 'credentialed', 'subscription']).toContain(reference.rights.access);
  expect(['allowed', 'cache-only', 'prohibited', 'unknown'])
    .toContain(reference.rights.fullTextStorage);
  expect(['allowed', 'metadata-only', 'prohibited', 'unknown'])
    .toContain(reference.rights.redistribution);
}

export function verifyDocument<TReference extends LegalResourceReference>(
  document: LegalResourceDocument<TReference>,
  expected: ExpectedLiveContract,
): void {
  verifyReference(document.reference, expected);
  expect(['markdown', 'html', 'text', 'xml']).toContain(document.content.format);
  expect(document.content.value.trim().length)
    .toBeGreaterThanOrEqual(expected.minimumContentLength ?? 40);
  expect(document.content.value).not.toContain('[object Object]');
}

export function verifyTableOfContents(
  tableOfContents: LegalTableOfContents,
  options: { minimumEntries?: number } = {},
): void {
  expect(['native', 'derived']).toContain(tableOfContents.origin);
  expect(Array.isArray(tableOfContents.entries)).toBe(true);
  expect(countEntries(tableOfContents.entries))
    .toBeGreaterThanOrEqual(options.minimumEntries ?? 1);
  for (const entry of tableOfContents.entries) verifyTocEntry(entry);
  reportLiveContract(
    tableOfContents.reference.provenance.providerId,
    tableOfContents.reference.provenance.sourceId,
    {
      capability: 'table-of-contents',
      origin: tableOfContents.origin,
      entries: countEntries(tableOfContents.entries),
    },
  );
}

export function verifyAuthentication(status: ProviderAuthenticationStatus): void {
  const diagnostic = status.message
    ? `Provider authentication failed: ${status.message}`
    : 'Provider authentication did not establish a session.';
  expect(status.state, diagnostic).toBe('authenticated');
  expect(
    ['credentials', 'institutional', 'network', 'persisted-session', 'other'],
    diagnostic,
  ).toContain(status.method);
}

export function verifyOperationalStatus(status: ProviderOperationalStatus): void {
  expect(status.state).not.toBe('unavailable');
  expect(Number.isNaN(Date.parse(status.checkedAt))).toBe(false);
  expect(status.queueDepth ?? 0).toBeGreaterThanOrEqual(0);
  expect(status.activeRequests ?? 0).toBeGreaterThanOrEqual(0);
}

export function reportLiveContract(
  provider: string,
  source: string,
  result: Readonly<Record<string, unknown>>,
): void {
  const safe = {
    provider,
    source,
    ...result,
    checkedAt: new Date().toISOString(),
  };
  process.stdout.write(`[live-contract] ${JSON.stringify(safe)}\n`);
}

function verifyTocEntry(entry: LegalTableOfContentsEntry): void {
  expect(entry.id.trim().length).toBeGreaterThan(0);
  expect(entry.title.trim().length).toBeGreaterThan(0);
  expect(entry.level).toBeGreaterThanOrEqual(0);
  for (const child of entry.children ?? []) verifyTocEntry(child);
}

function countEntries(entries: readonly LegalTableOfContentsEntry[]): number {
  return entries.reduce(
    (count, entry) => count + 1 + countEntries(entry.children ?? []),
    0,
  );
}

function failureMessage(
  failures: readonly { sourceId: string; message: string }[],
): string {
  return failures.map((failure) => `${failure.sourceId}: ${failure.message}`).join('; ');
}

export function reportableFailures(
  failures: readonly { sourceId: string; message: string }[],
): readonly { sourceId: string; message: string }[] {
  return failures.map(({ sourceId, message }) => ({ sourceId, message }));
}
