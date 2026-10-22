import axios from 'axios';
import type { AxiosInstance } from 'axios';
import type { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';
import { rootLogger } from '../../shared/logger.js';
import { EulConverter } from './converter.js';
import { validateConversion } from '../../shared/converter.js';
import { saveToFile } from '../../shared/save-to-file.js';
import { eulTools } from './tools/index.js';
import { EulDataClient, type EulLegislationText } from './data-client.js';
import { normalizeToolName } from '../../shared/tool-names.js';

const logger = rootLogger.child({ module: 'eul-provider' });

export class EulProvider implements Provider {
  readonly name = 'eul';
  private readonly client: EulDataClient;

  constructor(
    clientOrHttp: EulDataClient | Pick<AxiosInstance, 'get'> = axios,
    converter: EulConverter = new EulConverter(),
  ) {
    this.client = clientOrHttp instanceof EulDataClient
      ? clientOrHttp
      : new EulDataClient(clientOrHttp, converter);
  }

  getTools(): ToolDefinition[] {
    return eulTools;
  }

  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const canonicalName = normalizeToolName(toolName);
    if (canonicalName === 'eul_search') return this.handleSearch(args);
    if (canonicalName === 'eul_get_document') return this.handleGetDocument(args);
    return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }

  async shutdown(): Promise<void> {
    logger.info('EUL provider shutdown');
  }

  private async handleSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const { query, resource_type = 'any', language = 'DE', limit = 10 } = args as {
      query: string; resource_type?: string; language?: string; limit?: number;
    };

    logger.info('Searching EUR-Lex', { queryLength: query.length, resource_type });
    const bindings = await this.client.searchLegislation(query, {
      resourceType: resource_type,
      language,
      limit,
    });
    const markdown = bindings.map((b, i) => {
      const celex = b.celex;
      const title = b.title;
      return `${i + 1}. **${celex}**\n   ${title.slice(0, 200)}${title.length > 200 ? '…' : ''}`;
    }).join('\n\n');

    return {
      content: [{ type: 'text', text: `Found ${bindings.length} results:\n\n${markdown}` }],
    };
  }

  private async handleGetDocument(args: Record<string, unknown>): Promise<ToolResult> {
    const { celex, language = 'DE', section, save_path } = args as {
      celex: string; language?: string; section?: string; save_path?: string;
    };

    logger.info('Fetching EUR-Lex document', { celex, language });

    const text = await this.client.getLegislationText(celex, language);
    validateConversion(text.markdown, 'EUR-Lex');
    const source = describeSource(text);

    if (section) {
      const extracted = extractSection(text.markdown, section);
      if (!extracted) {
        return { content: [{ type: 'text', text: `Section "${section}" not found in CELEX ${text.celex}.` }], isError: true };
      }
      return { content: [{ type: 'text', text: `${source}\n\n---\n\n${extracted}` }] };
    }

    const fullDoc = `# ${text.celex}\n\n${source}\n\n---\n\n${text.markdown}`;

    if (save_path) {
      return saveToFile(save_path, fullDoc, `CELEX: ${text.celex}\nLanguage: ${text.language}`);
    }

    return { content: [{ type: 'text', text: fullDoc }] };
  }
}

/** One line stating which text this is — the published act or a consolidated version. */
function describeSource(text: EulLegislationText): string {
  if (text.version === 'consolidated') {
    const others = text.otherVersions?.length
      ? ` Other consolidated versions: ${text.otherVersions.slice(0, 10).join(', ')}${text.otherVersions.length > 10 ? ', …' : ''}.`
      : '';
    return `Source: EU Publications Office (Cellar), CELEX ${text.celex}, language ${text.language}. `
      + `Consolidated version as of ${text.consolidationDate}; consolidated texts are documentation, `
      + `only the Official Journal versions are legally binding.${others}`;
  }
  return `Source: EU Publications Office (Cellar), CELEX ${text.celex}, language ${text.language}. `
    + 'Text as published in the Official Journal, without later amendments or corrigenda; '
    + 'for the consolidated text request the CELEX with leading 0 instead of the sector digit (e.g. 02016R0679).';
}

const ARTICLE_WORDS = 'Artikel|Article|Articolo|Artículo|Artigo|Artykuł|Art\\.?';
const ANNEX_WORDS = ['anhang', 'anh', 'anlage', 'annex', 'annexe', 'allegato', 'bijlage', 'anexo', 'załącznik'];

export function extractSection(markdown: string, section: string): string | null {
  const lines = markdown.split('\n');

  // lines:100-200
  const lineMatch = section.match(/^lines?:(\d+)-(\d+)$/i);
  if (lineMatch) {
    const start = Math.max(1, Number.parseInt(lineMatch[1] ?? '1')) - 1;
    const end = Math.min(lines.length, Number.parseInt(lineMatch[2] ?? '1'));
    return lines.slice(start, end).join('\n');
  }

  // Art. 5 or Artikel 5 or Artikel 5-10
  const artMatch = section.match(new RegExp(`^(?:${ARTICLE_WORDS})\\s*(\\d+)(?:\\s*[-–]\\s*(\\d+))?$`, 'i'));
  if (artMatch) {
    const artStart = Number.parseInt(artMatch[1] ?? '0');
    const artEnd = artMatch[2] ? Number.parseInt(artMatch[2]) : artStart;
    return extractArticleRange(lines, artStart, artEnd);
  }

  // Anhang III, Anh. 3, Annex III — matched exactly, so "Anhang I" never
  // lands on "ANHANG II" or on a heading that merely mentions an annex.
  const annexMatch = section.match(/^(\p{L}+)\.?\s*([IVXLC]+|\d+)$/iu);
  const annexWord = annexMatch?.[1]?.toLowerCase();
  if (annexMatch && annexWord && ANNEX_WORDS.includes(annexWord)) {
    return extractAnnex(lines, toRoman(annexMatch[2] ?? ''));
  }

  // Kapitel III, Titel II Kapitel 1, Kapitel III Abschnitt 2
  const path = parseDivisionPath(section);
  if (path) return extractDivision(lines, path);

  // Any other heading text
  const q = section.toLowerCase();
  let startIdx = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const hm = lines[i]?.match(/^(#{1,6})\s+(.+)/);
    if (!hm) continue;
    const level = hm[1]?.length ?? 0;
    const text = hm[2]?.toLowerCase() ?? '';
    if (startIdx === -1) {
      if (text.includes(q)) { startIdx = i; startLevel = level; }
    } else if (level <= startLevel) {
      return lines.slice(startIdx, i).join('\n');
    }
  }
  if (startIdx !== -1) return lines.slice(startIdx).join('\n');
  return null;
}

/**
 * The structural divisions of an EU act, outermost first. All of them are
 * top-level headings in the converted text, so heading levels cannot say
 * where a chapter ends: its first section heading has the same level. The
 * rank can.
 */
const DIVISION_RANKS: ReadonlyArray<readonly [number, readonly string[]]> = [
  [1, ['teil', 'part', 'partie', 'parte', 'deel', 'część']],
  [2, ['titel', 'title', 'titre', 'titolo', 'título', 'titulo', 'tytuł']],
  [3, ['kapitel', 'chapter', 'chapitre', 'capo', 'capítulo', 'capitulo', 'hoofdstuk', 'rozdział']],
  [4, ['abschnitt', 'section', 'sezione', 'sección', 'secção', 'afdeling', 'sekcja']],
  [5, ['unterabschnitt', 'subsection', 'sous-section', 'sottosezione', 'subsección', 'subsecção', 'onderafdeling', 'podsekcja']],
];

interface Division {
  readonly rank: number;
  readonly number: number;
}

function divisionRank(word: string): number | null {
  const lower = word.toLowerCase();
  return DIVISION_RANKS.find(([, words]) => words.includes(lower))?.[0] ?? null;
}

function numeralValue(value: string): number | null {
  if (/^\d{1,3}$/.test(value)) return Number(value);
  const digits: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  const upper = value.toUpperCase();
  if (!/^[IVXLC]{1,12}$/.test(upper)) return null;
  let total = 0;
  for (let i = 0; i < upper.length; i++) {
    const current = digits[upper[i] ?? ''] ?? 0;
    const next = digits[upper[i + 1] ?? ''] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

/** "Kapitel III Abschnitt 2" → [{rank 3, 3}, {rank 4, 2}]; null if not a division path. */
function parseDivisionPath(section: string): Division[] | null {
  const tokens = section.trim().split(/\s+/);
  if (tokens.length === 0 || tokens.length % 2 !== 0) return null;
  const path: Division[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const rank = divisionRank((tokens[i] ?? '').replace(/\.$/, ''));
    const number = numeralValue(tokens[i + 1] ?? '');
    if (rank === null || number === null) return null;
    path.push({ rank, number });
  }
  return path;
}

/** A division heading in the converted text, or an annex (rank 0: ends everything). */
function headingDivision(line: string): Division | null {
  const match = /^#{1,6}\s+(\S+)\s+(\S+)\s*$/u.exec(line);
  if (!match) return null;
  const word = match[1] ?? '';
  if (ANNEX_WORDS.includes(word.toLowerCase())) return { rank: 0, number: 0 };
  const rank = divisionRank(word);
  const number = numeralValue(match[2] ?? '');
  return rank === null || number === null ? null : { rank, number };
}

function extractDivision(lines: string[], path: readonly Division[]): string | null {
  let from = 0;
  let to = lines.length;
  for (const wanted of path) {
    let start = -1;
    for (let i = from; i < to; i++) {
      const division = headingDivision(lines[i] ?? '');
      if (division && division.rank === wanted.rank && division.number === wanted.number) {
        start = i;
        break;
      }
    }
    if (start === -1) return null;
    let end = to;
    for (let i = start + 1; i < to; i++) {
      const division = headingDivision(lines[i] ?? '');
      if (division && division.rank <= wanted.rank) {
        end = i;
        break;
      }
    }
    from = start;
    to = end;
  }
  return lines.slice(from, to).join('\n');
}

function extractAnnex(lines: string[], numeral: string): string | null {
  if (!numeral) return null;
  const words = ANNEX_WORDS.join('|');
  const title = new RegExp(`^#\\s+(?:${words})\\s+${numeral}\\s*$`, 'iu');
  const start = lines.findIndex((line) => title.test(line));
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && /^#\s/.test(line));
  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

function toRoman(value: string): string {
  if (!/^\d+$/.test(value)) return value.toUpperCase();
  let number = Number.parseInt(value, 10);
  if (number < 1 || number > 399) return '';
  const numerals: Array<[number, string]> = [
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let roman = '';
  for (const [amount, symbol] of numerals) {
    while (number >= amount) { roman += symbol; number -= amount; }
  }
  return roman;
}

function extractArticleRange(lines: string[], artStart: number, artEnd: number): string | null {
  let startIdx = -1;
  let endIdx = lines.length;
  const artPattern = new RegExp(`^#{1,3}\\s+(?:${ARTICLE_WORDS})\\s+(\\d+)`, 'i');

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]?.match(artPattern);
    if (!m) continue;
    const num = Number.parseInt(m[1] ?? '0');
    if (num === artStart && startIdx === -1) startIdx = i;
    if (num > artEnd && startIdx !== -1) { endIdx = i; break; }
  }

  if (startIdx === -1) return null;
  // A chapter heading or the annexes after the range's last article belong to
  // what follows, not to the article.
  let lastArticle = startIdx;
  for (let i = startIdx; i < endIdx; i++) {
    if (artPattern.test(lines[i] ?? '')) lastArticle = i;
  }
  const boundary = lines.findIndex((line, index) => index > lastArticle && index < endIdx && /^#\s/.test(line));
  return lines.slice(startIdx, boundary === -1 ? endIdx : boundary).join('\n');
}
