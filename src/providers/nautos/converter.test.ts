import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './converter.js';

describe('nautos htmlToMarkdown', () => {
  it('applies the viewer-specific turndown rules', () => {
    const html = `<!DOCTYPE html><div xmlns="urn:iso">
      <a id="de:internal">anchor text</a>
      <h2><span class="tr--label">5.1</span> Anwendungsbereich</h2>
      <div class="tr--note"><span class="tr--non-normative-note-label">ANMERKUNG</span>
        <div class="tr--p">ANMERKUNG Dies ist ein Hinweis.</div></div>
      <div class="tr--li"><span class="tr--label">a)</span> erster Punkt</div>
      <div class="tr--caption">Tabelle 1 — Übersicht</div>
    </div>`;

    const md = htmlToMarkdown(html);

    expect(md).not.toContain('anchor text'); // stripped internal anchor
    expect(md).toMatch(/5\.1\s+Anwendungsbereich/); // inline heading label
    expect(md).toContain('> **ANMERKUNG**'); // note blockquote
    expect(md).toContain('Dies ist ein Hinweis.');
    expect(md).toMatch(/- a\)\s+erster Punkt/); // labelled list item
    expect(md).toContain('**Tabelle 1 — Übersicht**'); // caption
  });
});
