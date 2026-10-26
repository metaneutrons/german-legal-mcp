import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compareVersions,
  isUpdateCheckEnabled,
  UpdateChecker,
  updateNotice,
  type ReleaseInfo,
  type ReleaseSource,
} from './update-check.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function cachePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'glmcp-update-check-'));
  roots.push(root);
  return join(root, 'update-check.json');
}

function source(fetchLatest: ReleaseSource['fetchLatest']): ReleaseSource {
  return { fetchLatest, howToUpdate: 'run the installer.' };
}

describe('compareVersions', () => {
  it.each([
    ['4.1.0', '4.0.2', 1],
    ['4.0.2', '4.1.0', -1],
    ['4.1.0', '4.1.0', 0],
    ['4.10.0', '4.9.9', 1],
    ['4.1.0', '4.1.0-beta.442', 1],
    ['4.1.0-beta.442', '4.1.0', -1],
    ['4.1.0-beta.10', '4.1.0-beta.9', 1],
    ['4.1.0-beta', '4.1.0-beta.1', -1],
    ['4.1.0-alpha.1', '4.1.0-beta.1', -1],
  ])('orders %s against %s as %i', (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected);
  });

  it('refuses anything that is not a version', () => {
    expect(compareVersions('latest', '4.1.0')).toBeUndefined();
    expect(compareVersions('4.1', '4.1.0')).toBeUndefined();
  });
});

describe('updateNotice', () => {
  it('names both versions, the instruction for the model and the release notes', () => {
    const text = updateNotice('4.0.2', { version: '4.1.0', url: 'https://example.com/r' }, 'do it.');
    expect(text).toContain('German Legal MCP 4.1.0 has been released');
    expect(text).toContain('this server runs 4.0.2');
    expect(text).toContain('Tell the user once');
    expect(text).toContain('do it.');
    expect(text).toContain('Release notes: https://example.com/r');
  });
});

describe('UpdateChecker', () => {
  it('has no notice before the first check and no notice when up to date', async () => {
    const path = await cachePath();
    const checker = new UpdateChecker({
      source: source(async () => ({ version: '4.1.0' })),
      currentVersion: '4.1.0',
      cachePath: path,
    });
    expect(checker.notice()).toBeUndefined();
    await checker.refresh();
    expect(checker.notice()).toBeUndefined();
  });

  it('reports a newer release and keeps it for the next start', async () => {
    const path = await cachePath();
    const latest: ReleaseInfo = { version: '4.1.0', url: 'https://example.com/r' };
    const first = new UpdateChecker({
      source: source(async () => latest),
      currentVersion: '4.1.0-beta.442',
      cachePath: path,
    });
    await first.refresh();
    expect(first.notice()).toContain('4.1.0 has been released');

    const fetchLatest = vi.fn(async () => latest);
    const restarted = new UpdateChecker({
      source: source(fetchLatest),
      currentVersion: '4.1.0-beta.442',
      cachePath: path,
    });
    expect(restarted.notice()).toContain('this server runs 4.1.0-beta.442');
    await restarted.refresh();
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it('asks again once the interval has passed', async () => {
    const path = await cachePath();
    let clock = 1_000;
    const fetchLatest = vi.fn(async () => ({ version: '4.1.0' }));
    const checker = new UpdateChecker({
      source: source(fetchLatest),
      currentVersion: '4.0.2',
      cachePath: path,
      now: () => clock,
      intervalMs: 100,
    });
    await checker.refresh();
    clock += 99;
    await checker.refresh();
    clock += 1;
    await checker.refresh();
    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });

  it('keeps the last answer when a check fails', async () => {
    const path = await cachePath();
    await writeFile(path, JSON.stringify({ checkedAt: 0, latest: { version: '4.1.0' } }));
    const checker = new UpdateChecker({
      source: source(async () => { throw new Error('offline'); }),
      currentVersion: '4.0.2',
      cachePath: path,
    });
    await checker.refresh();
    expect(checker.notice()).toContain('4.1.0');
    expect(JSON.parse(await readFile(path, 'utf8')).checkedAt).toBe(0);
  });

  it('ignores a damaged cache file', async () => {
    const path = await cachePath();
    await writeFile(path, '{"checkedAt":"yesterday","latest":{"version":"x"}}');
    const checker = new UpdateChecker({
      source: source(async () => undefined),
      currentVersion: '4.0.2',
      cachePath: path,
    });
    expect(checker.notice()).toBeUndefined();
  });
});

describe('isUpdateCheckEnabled', () => {
  it('is on by default and off with GLMCP_UPDATE_CHECK=false', () => {
    expect(isUpdateCheckEnabled({})).toBe(true);
    expect(isUpdateCheckEnabled({ GLMCP_UPDATE_CHECK: 'false' })).toBe(false);
    expect(() => isUpdateCheckEnabled({ GLMCP_UPDATE_CHECK: 'no' })).toThrow(/GLMCP_UPDATE_CHECK/);
  });
});
