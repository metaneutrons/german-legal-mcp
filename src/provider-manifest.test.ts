import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENVIRONMENT_VARIABLES } from './config.js';
import { getProviderManifest, PROVIDER_MANIFEST } from './provider-manifest.js';
import { isCanonicalToolName } from './shared/tool-names.js';

describe('provider manifest', () => {
  it('has unique component ids', () => {
    const ids = PROVIDER_MANIFEST.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps component metadata and configuration contracts aligned', async () => {
    const knownVariables = new Set(ENVIRONMENT_VARIABLES.map((entry) => entry.name));
    await Promise.all(PROVIDER_MANIFEST.map(async (entry) => {
      const { component } = await entry.load();
      expect(component.metadata.id).toBe(entry.id);
      expect(component.metadata.distribution).toBe(entry.distribution);
      expect(component.metadata.description.length).toBeGreaterThan(0);
      expect(component.metadata.resourceTypes.length).toBeGreaterThan(0);
      expect(component.createDataClient).toEqual(expect.any(Function));
      const client = component.createDataClient() as unknown as Record<string, unknown>;
      expect(client.search).toEqual(expect.any(Function));
      expect(client.get).toEqual(expect.any(Function));
      expect(typeof client.getTableOfContents === 'function')
        .toBe(component.metadata.runtime.tableOfContents);
      expect(typeof client.getAuthenticationStatus === 'function')
        .toBe(component.metadata.runtime.authentication);
      expect(typeof client.getOperationalStatus === 'function')
        .toBe(component.metadata.runtime.status);
      expect(typeof client.enumerate === 'function')
        .toBe(component.metadata.runtime.enumeration);
      for (const variable of component.metadata.enablementVariables) {
        expect(knownVariables.has(variable), `${entry.id}: ${variable}`).toBe(true);
      }
    }));
  });

  it('documents every provider in the README (docs SSOT)', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf-8').toLowerCase();
    for (const entry of PROVIDER_MANIFEST) {
      expect(readme, `provider ${entry.id} is missing from README.md`)
        .toContain(entry.id.toLowerCase());
    }
  });

  it('advertises only portable tool names in the MCPB manifest', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'manifest.json'), 'utf-8'),
    ) as { tools: Array<{ name: string }> };

    expect(manifest.tools.length).toBeGreaterThan(0);
    for (const { name } of manifest.tools) {
      expect(isCanonicalToolName(name), `unsupported MCPB tool name: ${name}`).toBe(true);
    }
  });

  it('filters by distribution without mutating the manifest', () => {
    expect(getProviderManifest()).toBe(PROVIDER_MANIFEST);
    expect(getProviderManifest('public').map((entry) => entry.id)).toEqual([
      'arxiv',
      'dip',
      'eul',
      'icu',
      'legis',
      'rii',
      'ris',
      'nautos',
    ]);
  });

  it('lazy-loads all public provider modules', async () => {
    await Promise.all(getProviderManifest('public').map(async (entry) => {
      const mod = await entry.load();
      expect(mod.component.metadata.id).toBe(entry.id);
      expect(mod.component.createMcpProvider).toEqual(expect.any(Function));
    }));
  });
});

describe('rights declarations', () => {
  // SPDX identifier, expression, LicenseRef-, or the two SPDX sentinels.
  const SPDX = /^(NOASSERTION|NONE|LicenseRef-[A-Za-z0-9.-]+|[A-Za-z0-9.+-]+(?: (?:AND|OR|WITH) [A-Za-z0-9.+-]+)*)$/;

  /** Every `rights` object literal declared across the provider sources. */
  function declaredRights(): { file: string; redistribution: string; licence?: string }[] {
    const root = join(process.cwd(), 'src', 'providers');
    const out: { file: string; redistribution: string; licence?: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const { name } = entry;
        const full = join(dir, name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.isFile() || !name.endsWith('.ts') || name.includes('.test.')) continue;
        const src = readFileSync(full, 'utf-8');
        // Capture the whole rights literal, then read fields from it — a
        // line-anchored pattern silently reports a missing licence when the
        // declaration is merely formatted differently.
        for (const m of src.matchAll(/\{[^{}]*?redistribution:\s*'([a-z-]+)',[^{}]*?\}/g)) {
          const licence = m[0].match(/licence:\s*'([^']+)'/)?.[1];
          out.push({ file: full.replace(root, ''), redistribution: m[1]!, ...(licence ? { licence } : {}) });
        }
      }
    };
    walk(root);
    return out;
  }

  /** Provider directories actually present, which differs by distribution. */
  function providerCount(): number {
    const root = join(process.cwd(), 'src', 'providers');
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
  }

  it('declares an SPDX licence beside every redistribution policy', () => {
    const rights = declaredRights();
    // Counted, not hardcoded. A fixed floor encodes the provider count of
    // whichever tree it was written in, and distributions differ in how many
    // they carry — so a number that passes in one fails the build of another,
    // which is exactly what happened. What the floor actually guards is that
    // the scan above still matches anything at all; one declaration per
    // provider says that without needing to know how many there are.
    expect(rights.length).toBeGreaterThanOrEqual(providerCount());
    for (const r of rights) {
      expect(r.licence, `${r.file} has a policy but no licence`).toBeDefined();
      expect(SPDX.test(r.licence!), `${r.file}: "${r.licence}" is not SPDX`).toBe(true);
    }
  });

  it('never grants redistribution on a licence nobody has read', () => {
    // `allowed` + `NOASSERTION` would have §3.4 serve full text on the strength
    // of a licence no one has determined. That pairing is the single thing this
    // field exists to make impossible to write by accident.
    for (const r of declaredRights()) {
      expect(
        r.redistribution === 'allowed' && r.licence === 'NOASSERTION',
        `${r.file}: redistribution 'allowed' with licence NOASSERTION`,
      ).toBe(false);
    }
  });
});
