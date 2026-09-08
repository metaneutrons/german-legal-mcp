import type { DipDocument } from '../client.js';
import type { DipDataClient } from '../data-client.js';
import type { ToolResult } from '../../../shared/types.js';

function formatVorgang(d: DipDocument): string {
  const lines: string[] = [];
  lines.push(`**${d.id}** — ${d.titel.replace(/\r\n/g, ' ').trim()}`);
  if (d.vorgangstyp) lines.push(`Typ: ${d.vorgangstyp}`);
  if (d.beratungsstand) lines.push(`Stand: ${d.beratungsstand}`);
  lines.push(`Datum: ${d.datum}`);
  if (d.wahlperiode) lines.push(`WP: ${d.wahlperiode}`);
  if (d.deskriptor?.length) {
    const sachbegriffe = d.deskriptor.filter(d => d.typ === 'Sachbegriffe').map(d => d.name);
    if (sachbegriffe.length) lines.push(`Deskriptoren: ${sachbegriffe.join(', ')}`);
  }
  return lines.join('\n');
}

export async function handleSearchVorgang(client: DipDataClient, args: Record<string, unknown>): Promise<ToolResult> {
  const { query, vorgangstyp, wahlperiode, date_start, date_end, limit = 10 } = args as {
    query: string; vorgangstyp?: string; wahlperiode?: number;
    date_start?: string; date_end?: string; limit?: number;
  };

  const params: Record<string, string | number> = { 'f.titel': query, rows: limit };
  if (vorgangstyp) params['f.vorgangstyp'] = vorgangstyp;
  if (wahlperiode) params['f.wahlperiode'] = wahlperiode;
  if (date_start) params['f.datum.start'] = date_start;
  if (date_end) params['f.datum.end'] = date_end;

  const result = await client.searchVorgang(params);
  const text = `${result.numFound} Vorgänge\n\n${result.documents.map(formatVorgang).join('\n\n---\n\n')}`;
  return { content: [{ type: 'text', text }] };
}
