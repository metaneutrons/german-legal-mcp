import { saveToFile } from '../../../shared/save-to-file.js';
import type { TocSection } from '../client.js';
import type { NautosDataClient } from '../data-client.js';
import type { ToolResult } from '../../../shared/types.js';
import * as cache from '../cache.js';
import { htmlToMarkdown } from '../converter.js';
import { extractSection } from '../../../shared/extract-section.js';
import {
  NAUTOS_MAX_TOC_DEPTH,
  NAUTOS_MAX_TOC_NODES,
} from '../client.js';
import {
  NAUTOS_MAX_DOCUMENT_BYTES,
  NAUTOS_MAX_SECTION_BYTES,
} from '../cache.js';

function formatToc(sections: TocSection[]): string {
  const lines: string[] = [];
  const stack = sections.slice().reverse().map((section) => ({ section, depth: 0 }));
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes++;
    if (nodes > NAUTOS_MAX_TOC_NODES || current.depth > NAUTOS_MAX_TOC_DEPTH) {
      throw new RangeError('nautos TOC exceeds the configured structural limits');
    }
    const { section, depth } = current;
    const indent = '  '.repeat(depth);
    const label = section.label ? `${section.label} ` : '';
    lines.push(`${indent}- ${label}${section.title} [\`${section.id}\`]`);
    if (section.section) {
      for (let index = section.section.length - 1; index >= 0; index--) {
        stack.push({ section: section.section[index]!, depth: depth + 1 });
      }
    }
  }
  return lines.join('\n');
}

async function fetchAndCache(client: NautosDataClient, acCode: string): Promise<cache.CachedDocument> {
  const detail = await client.getDetail(acCode);
  if (!detail.din21Id) throw new Error(`No fulltext available for ${acCode} (format: ${detail.format ?? 'unknown'})`);
  const toc = await client.getToc(detail.din21Id);
  const doc: cache.CachedDocument = { acCode, din21Id: detail.din21Id, detail, toc, sections: {}, fetchedAt: Date.now() };
  await cache.put(doc);
  return doc;
}

function formatOutline(doc: cache.CachedDocument): string {
  const d = doc.detail;
  const header = [
    `# ${d.documentNumber}`,
    `**${d.titleDe}**`,
    d.titleEn ? `*${d.titleEn}*` : '',
    `\nDatum: ${d.dateOfIssue} | Gültig: ${d.valid ? 'Ja' : 'Nein'} | acCode: \`${d.acCode}\` | din21Id: \`${doc.din21Id}\``,
    d.classificationIcs?.length ? `ICS: ${d.classificationIcs.join(', ')}` : '',
  ].filter(Boolean).join('\n');
  return `${header}\n\n## Inhaltsverzeichnis\n\n${formatToc(doc.toc)}\n\n---\n*Use \`section\` parameter with a section ID (e.g. \`sub-4.1\`) to fetch content.*`;
}

async function fetchAllSections(client: NautosDataClient, doc: cache.CachedDocument): Promise<string> {
  const allIds = flattenSectionIds(doc.toc);
  const parts: string[] = [
    formatOutline(doc).split('## Inhaltsverzeichnis')[0]?.trim() ?? '',
  ];
  let totalBytes = Buffer.byteLength(parts[0] ?? '', 'utf8');
  const append = (markdown: string): void => {
    const sectionBytes = Buffer.byteLength(markdown, 'utf8');
    if (sectionBytes > NAUTOS_MAX_SECTION_BYTES) {
      throw new RangeError(`nautos section exceeds ${NAUTOS_MAX_SECTION_BYTES} bytes`);
    }
    totalBytes += sectionBytes + Buffer.byteLength('\n\n---\n\n', 'utf8');
    if (totalBytes > NAUTOS_MAX_DOCUMENT_BYTES) {
      throw new RangeError(`nautos full document exceeds ${NAUTOS_MAX_DOCUMENT_BYTES} bytes`);
    }
    parts.push(markdown);
  };
  for (const id of allIds) {
    if (doc.sections[id]) { append(doc.sections[id]); continue; }
    const html = await client.getSection(doc.din21Id, id);
    if (html) {
      const md = htmlToMarkdown(html);
      doc.sections[id] = md;
      append(md);
      // Merge one section at a time under the cache's cross-process
      // transaction; writing the caller's whole stale document would discard
      // sections fetched concurrently by another MCP process.
      await cache.putSection(doc.acCode, id, md);
    }
  }
  return parts.join('\n\n---\n\n');
}

export function flattenSectionIds(sections: TocSection[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const stack = sections.slice().reverse().map((section) => ({ section, depth: 0 }));
  let nodes = 0;
  while (stack.length > 0) {
    const { section, depth } = stack.pop()!;
    nodes++;
    if (nodes > NAUTOS_MAX_TOC_NODES || depth > NAUTOS_MAX_TOC_DEPTH) {
      throw new RangeError('nautos TOC exceeds the configured structural limits');
    }
    if (typeof section.id !== 'string' || section.id.length === 0) {
      throw new TypeError('nautos TOC contains an empty section id');
    }
    if (!seen.has(section.id)) {
      seen.add(section.id);
      ids.push(section.id);
    }
    if (section.section) {
      if (!Array.isArray(section.section)) {
        throw new TypeError('nautos TOC contains invalid child sections');
      }
      for (let index = section.section.length - 1; index >= 0; index--) {
        stack.push({ section: section.section[index]!, depth: depth + 1 });
      }
    }
  }
  return ids;
}

export async function handleGetDocument(client: NautosDataClient, args: Record<string, unknown>): Promise<ToolResult> {
  const { acCode, section, save_path } = args as { acCode: string; section?: string; save_path?: string };

  let doc = await cache.get(acCode);
  if (!doc) doc = await fetchAndCache(client, acCode);

  // Outline only
  if (!section && !save_path) {
    return { content: [{ type: 'text', text: formatOutline(doc) }] };
  }

  // Section request
  if (section && !save_path) {
    // Line range or heading search → need full text
    if (section.match(/^lines?:/i) || !section.match(/^(sub-|title\.|foreword\.|introduction\.)/)) {
      // Try to find in cached sections, else treat as heading search
      const allMd = Object.values(doc.sections).join('\n\n');
      if (allMd) return { content: [{ type: 'text', text: extractSection(allMd, section) }] };
    }

    // Direct section ID
    if (doc.sections[section]) {
      return { content: [{ type: 'text', text: doc.sections[section] }] };
    }
    const html = await client.getSection(doc.din21Id, section);
    if (!html) return { content: [{ type: 'text', text: `Section "${section}" not found.` }], isError: true };
    const md = htmlToMarkdown(html);
    if (Buffer.byteLength(md, 'utf8') > NAUTOS_MAX_SECTION_BYTES) {
      throw new RangeError(`nautos section exceeds ${NAUTOS_MAX_SECTION_BYTES} bytes`);
    }
    await cache.putSection(acCode, section, md);
    return { content: [{ type: 'text', text: md }] };
  }

  // Save full document
  if (save_path) {
    const full = await fetchAllSections(client, doc);
    return saveToFile(save_path, full, `${doc.detail.documentNumber} (${flattenSectionIds(doc.toc).length} sections)`);
  }

  return { content: [{ type: 'text', text: formatOutline(doc) }] };
}
