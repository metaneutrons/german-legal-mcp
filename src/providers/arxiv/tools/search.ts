import type { ArxivEntry } from '../client.js';
import type { ArxivDataClient } from '../data-client.js';
import type { ToolResult } from '../../../shared/types.js';

function formatEntry(e: ArxivEntry): string {
  const lines = [
    `**${e.id}** — ${e.title}`,
    `Autoren: ${e.authors.slice(0, 5).join(', ')}${e.authors.length > 5 ? ` (+${e.authors.length - 5})` : ''}`,
    `Datum: ${e.published} | Kategorien: ${e.primaryCategory}`,
  ];
  if (e.doi) lines.push(`DOI: ${e.doi}`);
  if (e.journalRef) lines.push(`Journal: ${e.journalRef}`);
  lines.push(`PDF: ${e.pdfUrl}`);
  return lines.join('\n');
}

export async function handleSearch(client: ArxivDataClient, args: Record<string, unknown>): Promise<ToolResult> {
  const { query, limit = 10, start = 0, sort_by } = args as {
    query: string; limit?: number; start?: number; sort_by?: string;
  };

  const params: Record<string, string | number> = { search_query: query, max_results: limit, start };
  if (sort_by) params.sortBy = sort_by;

  const { total, entries } = await client.searchEntries(params);
  const text = `${total} Treffer (showing ${entries.length})\n\n${entries.map(formatEntry).join('\n\n---\n\n')}`;
  return { content: [{ type: 'text', text }] };
}
