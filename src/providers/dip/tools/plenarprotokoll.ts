import type { DipDocument } from '../client.js';
import type { DipDataClient } from '../data-client.js';
import type { ToolResult } from '../../../shared/types.js';

function formatProtokoll(d: DipDocument): string {
  const lines: string[] = [];
  lines.push(`**${d.dokumentnummer ?? d.id}** — ${d.titel.replace(/\r\n/g, ' ').trim()}`);
  lines.push(`Datum: ${d.datum}`);
  if (d.herausgeber) lines.push(`Herausgeber: ${d.herausgeber}`);
  if (d.fundstelle?.pdf_url) lines.push(`PDF: ${d.fundstelle.pdf_url}`);
  if (d.vorgangsbezug?.length) {
    const top = d.vorgangsbezug.slice(0, 5);
    lines.push(`Vorgänge: ${top.map(v => v.titel.replace(/\r\n/g, ' ').trim()).join('; ')}${d.vorgangsbezug.length > 5 ? ` (+${d.vorgangsbezug.length - 5})` : ''}`);
  }
  return lines.join('\n');
}

export async function handleSearchPlenarprotokoll(client: DipDataClient, args: Record<string, unknown>): Promise<ToolResult> {
  const { query, wahlperiode, herausgeber, date_start, date_end, limit = 10 } = args as {
    query: string; wahlperiode?: number; herausgeber?: string;
    date_start?: string; date_end?: string; limit?: number;
  };

  const params: Record<string, string | number> = { 'f.text': query, rows: limit };
  if (wahlperiode) params['f.wahlperiode'] = wahlperiode;
  if (herausgeber) params['f.herausgeber'] = herausgeber;
  if (date_start) params['f.datum.start'] = date_start;
  if (date_end) params['f.datum.end'] = date_end;

  const result = await client.searchPlenarprotokollText(params);
  const text = `${result.numFound} Protokolle\n\n${result.documents.map(formatProtokoll).join('\n\n---\n\n')}`;
  return { content: [{ type: 'text', text }] };
}
