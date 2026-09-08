import type { DipDocument } from '../client.js';
import type { DipDataClient } from '../data-client.js';
import type { ToolResult } from '../../../shared/types.js';

function formatDoc(d: DipDocument): string {
  const lines: string[] = [];
  lines.push(`**${d.dokumentnummer ?? d.id}** — ${d.titel.replace(/\r\n/g, ' ').trim()}`);
  if (d.drucksachetyp) lines.push(`Typ: ${d.drucksachetyp}`);
  lines.push(`Datum: ${d.datum}`);
  if (d.herausgeber) lines.push(`Herausgeber: ${d.herausgeber}`);
  if (d.urheber?.length) lines.push(`Urheber: ${d.urheber.map(u => u.titel).join(', ')}`);
  if (d.ressort?.length) lines.push(`Ressort: ${d.ressort.filter(r => r.federfuehrend).map(r => r.titel).join(', ')}`);
  if (d.fundstelle?.pdf_url) lines.push(`PDF: ${d.fundstelle.pdf_url}`);
  return lines.join('\n');
}

export async function handleSearch(client: DipDataClient, args: Record<string, unknown>): Promise<ToolResult> {
  const { query, type, wahlperiode, herausgeber, date_start, date_end, limit = 10 } = args as {
    query: string; type?: string; wahlperiode?: number; herausgeber?: string;
    date_start?: string; date_end?: string; limit?: number;
  };

  const params: Record<string, string | number> = { 'f.titel': query, rows: limit };
  if (type) params['f.drucksachetyp'] = type;
  if (wahlperiode) params['f.wahlperiode'] = wahlperiode;
  if (herausgeber) params['f.herausgeber'] = herausgeber;
  if (date_start) params['f.datum.start'] = date_start;
  if (date_end) params['f.datum.end'] = date_end;

  const result = await client.searchDrucksachen(params);
  const text = `${result.numFound} Treffer\n\n${result.documents.map(formatDoc).join('\n\n---\n\n')}`;
  return { content: [{ type: 'text', text }] };
}
