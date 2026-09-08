import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockAxios } = vi.hoisted(() => ({ mockAxios: { get: vi.fn() } }));
vi.mock('axios', () => ({ default: mockAxios }));

import { ArxivClient } from './client.js';

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>42</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2501.00001v1</id>
    <title>Legal   AI
      Systems</title>
    <summary>  A study.  </summary>
    <published>2025-01-01T00:00:00Z</published>
    <updated>2025-01-02T00:00:00Z</updated>
    <author><name>Alice</name></author>
    <author><name>Bob</name></author>
    <category term="cs.CY"/>
    <arxiv:primary_category term="cs.CY"/>
    <arxiv:doi>10.1/x</arxiv:doi>
    <arxiv:journal_ref>J. Law 2025</arxiv:journal_ref>
  </entry>
</feed>`;

beforeEach(() => mockAxios.get.mockReset());

describe('ArxivClient', () => {
  it('parses an Atom feed into normalized entries', async () => {
    mockAxios.get.mockResolvedValue({ data: ATOM });

    const { total, entries } = await new ArxivClient().search({ search_query: 'law' });

    expect(total).toBe(42);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.id).toBe('2501.00001v1');
    expect(e.title).toBe('Legal AI Systems'); // whitespace collapsed
    expect(e.summary).toBe('A study.');
    expect(e.authors).toEqual(['Alice', 'Bob']);
    expect(e.published).toBe('2025-01-01');
    expect(e.primaryCategory).toBe('cs.CY');
    expect(e.doi).toBe('10.1/x');
    expect(e.journalRef).toBe('J. Law 2025');
    expect(e.comment).toBeUndefined();
    expect(e.pdfUrl).toBe('https://arxiv.org/pdf/2501.00001v1');
  });

  it('returns the HTML body for a paper', async () => {
    mockAxios.get.mockResolvedValue({ data: '<h1>Intro</h1>' });
    await expect(new ArxivClient().getHtml('2501.00001')).resolves.toBe('<h1>Intro</h1>');
  });

  it('returns null when the HTML fetch fails', async () => {
    mockAxios.get.mockImplementationOnce(() => Promise.reject(new Error('404')));
    await expect(new ArxivClient().getHtml('2501.00001')).resolves.toBeNull();
  });
});
