import { describe, expect, it } from 'vitest';
import { convertBayernDecision } from './converter.js';

const html = `<html><head>
<title>AG München, Endurteil v. 09.04.2021 – 142 C 14251/20 - Bürgerservice</title>
</head><body>
<h1 class="titelzeile">Mietminderung bei Schimmel</h1>
<div class="leitsatz">Der Mieter darf die Miete mindern.</div>
<div class="rsprbox">
  <div class="rsprboxueber">Normenketten</div>
  <div class="rsprboxzeile">§ 535 BGB</div>
  <div class="rsprboxzeile">§ 536 BGB</div>
  <div class="rsprboxueber">Fundstelle</div>
  <div class="rsprboxzeile">BeckRS 2021, 12345</div>
</div>
<div class="cont"><div class="rd">1</div><p>Die Klage ist begründet.</p></div>
</body></html>`;

describe('convertBayernDecision', () => {
  it('extracts metadata from the title tag', () => {
    const result = convertBayernDecision(html);
    expect(result.court).toBe('AG München');
    expect(result.date).toBe('09.04.2021');
    expect(result.fileNumber).toBe('142 C 14251/20');
  });

  it('accepts multiword decision types in the portal title', () => {
    const result = convertBayernDecision(html.replace(
      'Endurteil',
      'Aussetzungs- und Vorlagebeschluss',
    ));
    expect(result.court).toBe('AG München');
    expect(result.date).toBe('09.04.2021');
    expect(result.fileNumber).toBe('142 C 14251/20');
  });

  it('extracts the headline, Leitsätze and rsprbox groups', () => {
    const result = convertBayernDecision(html);
    expect(result.title).toBe('Mietminderung bei Schimmel');
    expect(result.leitsaetze).toEqual(['Der Mieter darf die Miete mindern.']);
    expect(result.normenketten).toEqual(['§ 535 BGB', '§ 536 BGB']);
    expect(result.fundstelle).toBe('BeckRS 2021, 12345');
  });

  it('renders content with Randnummern markers', () => {
    const result = convertBayernDecision(html);
    expect(result.content).toContain('[Rn. 1]{.rn}');
    expect(result.content).toContain('Die Klage ist begründet');
  });
});
