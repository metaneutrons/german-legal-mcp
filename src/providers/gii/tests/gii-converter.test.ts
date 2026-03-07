import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GiiConverter } from '../converter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('GiiConverter', () => {
  const converter = new GiiConverter();

  it('should extract BGB § 823', () => {
    const buffer = readFileSync(join(__dirname, 'fixtures/gii-bgb-823.html'));
    const html = buffer.toString('latin1');
    const result = converter.extractLegislation(html);

    expect(result.title).toContain('Bürgerliches Gesetzbuch');
    expect(result.title).toContain('§ 823');
    expect(result.title).toContain('Schadensersatzpflicht');
    expect(result.section).toBe('§ 823');
    expect(result.content).toContain('vorsätzlich oder fahrlässig');
    expect(result.content).toContain('Ersatz');
    expect(result.content).toContain('Schadens');
    expect(result.prev).toBe('__822.html');
    expect(result.next).toBe('__824.html');
  });

  it('should extract StGB § 242', () => {
    const buffer = readFileSync(join(__dirname, 'fixtures/gii-stgb-242.html'));
    const html = buffer.toString('latin1');
    const result = converter.extractLegislation(html);

    expect(result.title).toContain('Strafgesetzbuch');
    expect(result.title).toContain('§ 242');
    expect(result.title).toContain('Diebstahl');
    expect(result.section).toBe('§ 242');
    expect(result.content).toContain('fremde bewegliche Sache');
    expect(result.prev).toBe('__241a.html');
    expect(result.next).toBe('__243.html');
  });
});
