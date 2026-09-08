import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { FederalDecisionAdapter } from './federal.js';

describe('FederalDecisionAdapter', () => {
  it('regresses search and conversion against a real RII-shaped HTML sample', async () => {
    const html = await readFile(new URL('./fixtures/federal-decision.html', import.meta.url), 'utf8');
    const http = { get: vi.fn(async (_url: string, options?: { params?: Record<string, string> }) => ({ data: options?.params?.['doc.id'] ? html : '<a class="TrefferlisteHervorheben" id="tlid1" href="?doc.id=case-1" title="BGH, Urteil">BGH, Urteil</a>' })) };
    const adapter = new FederalDecisionAdapter(http);
    await expect(adapter.search('BUND', 'copyright', 1)).resolves.toMatchObject([{ id: 'case-1', title: 'BGH, Urteil' }]);
    await expect(adapter.get('BUND', 'case-1')).resolves.toMatchObject({ court: 'BGH', fileNumber: 'I ZR 1/25', ecli: 'ECLI:DE:BGH:2021:090421UIZR1.25.0', content: expect.stringContaining('Die Klage ist zulässig') });
  });

  it('extracts court, date, file number and a real title from a live result row', async () => {
    // Copied from a live Trefferliste. The link's own title attribute is the
    // hit's ordinal, so every other field has to come out of the row.
    const row = '<table><tr valign="top">'
      + '<td class="TableUntenContent"><span>28.07.2026</span></td>'
      + '<td class="TableUntenContent">'
      + '<a id="tlid1" class="TrefferlisteHervorheben" title="1. Treffer Langtext" '
      + 'href="page/x?doc.hl=1&amp;doc.id=jb-KORE607392026&amp;numberofresults=6296">'
      + '<span><strong>BGH 6a. Zivilsenat</strong> | VIa ZR 782/23'
      + "<span class='tlAsyncData' style='display:none'> </span><br />"
      + '<em>Urteil</em> | <strong>Der Kläger nimmt die Beklagte wegen der Verwendung '
      + 'unzulässiger Abschalteinrichtungen in Anspruch.</strong></span>'
      + '<br/><span class="docPreview"><br/>... auf Schadensersatz in Anspruch. ...</span>'
      + '</a></td></tr></table>';
    const adapter = new FederalDecisionAdapter({ get: vi.fn(async () => ({ data: row })) });

    const [hit] = await adapter.search('BUND', 'Schadensersatz', 1);

    expect(hit).toMatchObject({
      id: 'jb-KORE607392026',
      date: '28.07.2026',
      court: 'BGH 6a. Zivilsenat',
      // The decision type must not bleed into the file number: the two are
      // separated only by the <br>, which text extraction erases.
      fileNumber: 'VIa ZR 782/23',
    });
    expect(hit?.title).toContain('Der Kläger nimmt die Beklagte');
    expect(hit?.title).not.toContain('Treffer');
    expect(hit?.subtitle).toBe('Urteil | BGH 6a. Zivilsenat | VIa ZR 782/23');
  });

  it('reads the total from numberofresults on a search response', async () => {
    const html = '<input type="hidden" name="numberofresults" value="6296" />'
      + '<a class="TrefferlisteHervorheben" id="tlid1" href="?doc.id=c1">x</a>';
    const adapter = new FederalDecisionAdapter({ get: vi.fn(async () => ({ data: html })) });
    await expect(adapter.searchPage('BUND', 'x', 1)).resolves.toMatchObject({ totalHits: 6296 });
  });
});

describe('FederalDecisionAdapter enumeration', () => {
  async function tocAdapter() {
    const xml = await readFile(new URL('./fixtures/rii-toc.xml', import.meta.url), 'utf8');
    const get = vi.fn(async () => ({ data: xml }));
    return { adapter: new FederalDecisionAdapter({ get }), get };
  }

  it('walks the published table of contents, sorted and entity-decoded', async () => {
    const { adapter } = await tocAdapter();
    const page = await adapter.enumerate('BUND');

    expect(page.origin).toBe('derived');
    expect(page.nextCursor).toBeUndefined();
    expect(page.results.map((r) => r.id)).toEqual([
      'jb-JURE100054597', 'jb-KORE300012024', 'jb-STRE201950123', 'jb-WBRE410000001',
    ]);
    expect(page.results[2]).toMatchObject({
      court: 'BGH Senat für Anwaltssachen',
      fileNumber: 'AnwZ (Brfg) 1/23 & 2/23',
      date: '2024-03-01',
    });
  });

  it('keeps the jb- prefix, because that is what doc.id and therefore get() expects', async () => {
    const { adapter } = await tocAdapter();
    const [first] = (await adapter.enumerate('BUND')).results;
    // A live result row links to `doc.id=jb-KORE607392026`; stripping the
    // prefix here would yield references that cannot be fetched.
    expect(first?.id).toMatch(/^jb-/);
    expect(first?.url).toBe(
      'https://www.rechtsprechung-im-internet.de/jportal/portal/page/bsjrsprod.psml?doc.id=jb-JURE100054597',
    );
  });

  it('filters on the feed modification stamp, accepting a date-only bound', async () => {
    const { adapter } = await tocAdapter();
    const page = await adapter.enumerate('BUND', { since: '2026-08-01' });
    expect(page.results.map((r) => r.id)).toEqual(['jb-STRE201950123', 'jb-WBRE410000001']);
  });

  it('pages by last id emitted, without repeating or skipping an entry', async () => {
    const { adapter } = await tocAdapter();
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await adapter.enumerate('BUND', { limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...page.results.map((r) => r.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual([
      'jb-JURE100054597', 'jb-KORE300012024', 'jb-STRE201950123', 'jb-WBRE410000001',
    ]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('downloads the 23 MB listing once per walk, not once per page', async () => {
    const { adapter, get } = await tocAdapter();
    await adapter.enumerate('BUND', { limit: 1 });
    await adapter.enumerate('BUND', { limit: 1, cursor: 'jb-JURE100054597' });
    await adapter.enumerate('BUND', { limit: 1, cursor: 'jb-KORE300012024' });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('fetches the table of contents once when pages start concurrently', async () => {
    const { adapter, get } = await tocAdapter();
    await Promise.all([adapter.enumerate('BUND'), adapter.enumerate('BUND')]);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
