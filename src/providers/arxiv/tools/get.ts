import { saveToFile } from '../../../shared/save-to-file.js';
import type { ArxivDataClient } from '../data-client.js';
import type { ToolResult } from '../../../shared/types.js';
import { htmlToMarkdown } from '../converter.js';
import { extractSection } from '../../../shared/extract-section.js';

export async function handleGet(client: ArxivDataClient, args: Record<string, unknown>): Promise<ToolResult> {
  const { id, section, save_path } = args as { id: string; section?: string; save_path?: string };

  // Always fetch metadata from Atom API
  const entry = await client.getEntry(id);
  if (entry === null) {
    return { content: [{ type: 'text', text: `Paper ${id} not found.` }], isError: true };
  }
  const header = [
    `# ${entry.title}`,
    `\n**Autoren:** ${entry.authors.join(', ')}`,
    `**Datum:** ${entry.published} | **Kategorien:** ${entry.categories.join(', ')}`,
    entry.doi ? `**DOI:** ${entry.doi}` : '',
    entry.journalRef ? `**Journal:** ${entry.journalRef}` : '',
    `**PDF:** ${entry.pdfUrl}`,
  ].filter(Boolean).join('\n');

  // Full text only when section or save_path requested
  if (!section && !save_path) {
    return { content: [{ type: 'text', text: `${header}\n\n## Abstract\n\n${entry.summary}` }] };
  }

  const html = await client.getHtml(entry.id);
  if (!html) {
    const msg = `${header}\n\n## Abstract\n\n${entry.summary}\n\n---\n*Full HTML text not available for this paper (pre-2024). Use the PDF link above.*`;
    return { content: [{ type: 'text', text: msg }] };
  }

  const markdown = `${header}\n\n---\n\n${htmlToMarkdown(html)}`;

  if (save_path) {
    return saveToFile(save_path, markdown);
  }

  return {
    content: [{
      type: 'text',
      text: extractSection(markdown, section ?? ''),
    }],
  };
}
