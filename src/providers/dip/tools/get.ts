import { saveToFile } from '../../../shared/save-to-file.js';
import type { DipDataClient } from '../data-client.js';
import type { ToolResult } from '../../../shared/types.js';
import { extractSection } from '../../../shared/extract-section.js';

export async function handleGet(client: DipDataClient, args: Record<string, unknown>): Promise<ToolResult> {
  const { dokumentnummer, section, save_path } = args as {
    dokumentnummer: string; section?: string; save_path?: string;
  };

  // Search by dokumentnummer in the -text endpoint to get full text
  const result = await client.searchDrucksachenText({ 'f.dokumentnummer': dokumentnummer, rows: 1 });
  if (!result.documents.length) {
    return { content: [{ type: 'text', text: `Drucksache ${dokumentnummer} not found.` }], isError: true };
  }

  const doc = result.documents.at(0);
  if (doc === undefined) {
    return {
      content: [{ type: 'text', text: `Drucksache ${dokumentnummer} not found.` }],
      isError: true,
    };
  }
  const fullText = doc.text ?? '';
  const header = `# BT-Drs. ${doc.dokumentnummer}\n\n**${doc.titel.replace(/\r\n/g, ' ').trim()}**\nDatum: ${doc.datum}\n${doc.fundstelle?.pdf_url ? `PDF: ${doc.fundstelle.pdf_url}` : ''}\n\n---\n\n`;

  if (save_path) {
    return saveToFile(save_path, header + fullText);
  }

  if (section) {
    const extracted = extractSection(fullText, section);
    return { content: [{ type: 'text', text: extracted }] };
  }

  // Default: return header + first 2000 chars as preview
  const preview = fullText.length > 2000 ? fullText.slice(0, 2000) + '\n\n[...truncated. Use `section` or `save_path` for full content.]' : fullText;
  return { content: [{ type: 'text', text: header + preview }] };
}
