/**
 * One rendering for every provider's search results.
 *
 * Search hit lists are homogeneous and tabular, which is exactly the shape that
 * punishes per-row JSON keys: measured over 20-30 rows, pretty-printed JSON
 * costs ~2.3x and prose-labelled markdown ~1.3x what the same fields cost
 * tab-delimited, purely in repeated field names and punctuation.
 *
 * So `compact` is the default and `compact-json` uses a columnar
 * `{fields, rows}` shape rather than an array of objects — the field names are
 * written once either way. Both carry identical data; the choice is transport,
 * never content.
 */

export type SearchFormat = 'compact' | 'compact-json';

/** Shown on every `format` parameter so callers know the default loses nothing. */
export const SEARCH_FORMAT_DESCRIPTION =
  'Output format. "compact" (default) is tab-delimited and by far the most '
  + 'token-efficient; it carries exactly the same fields as "compact-json", so '
  + 'switching gains no information. Choose "compact-json" only to hand rows '
  + 'straight to a program.';

/** Stands in for a missing value so a row can never collapse a column. */
export const EMPTY_CELL = '—';

export interface SearchColumn<T> {
  readonly header: string;
  readonly value: (row: T) => string | number | undefined | null;
  /**
   * Truncate at this many characters, marking the cut with an ellipsis.
   *
   * Some portals put an entire Schlagwörter list in the title field — one live
   * Niedersachsen hit ran ~700 characters and was a third of a twelve-result
   * response by itself. A title only has to be recognizable enough to choose
   * whether to retrieve the document, and the full text is one call away.
   */
  readonly maxWidth?: number;
}

export interface SearchTable<T> {
  readonly columns: readonly SearchColumn<T>[];
  readonly rows: readonly T[];
  /**
   * Prose lines placed above the table — totals, per-source counts, dropped
   * duplicates, source failures. Deliberately not tabular: this part is small,
   * heterogeneous and read once, where prose is both cheaper and clearer.
   */
  readonly summary?: readonly string[];
  /** Opaque continuation token; omitted when the result set is exhausted. */
  readonly cursor?: string;
  readonly format?: SearchFormat;
}

/**
 * Collapse anything that would corrupt a delimited row. Tabs and newlines are
 * the only true structural hazards; the surrounding whitespace collapse also
 * strips the ragged indentation that HTML-derived titles carry.
 */
function cell(value: string | number | undefined | null, maxWidth?: number): string {
  if (value === undefined || value === null) return EMPTY_CELL;
  const text = String(value).replace(/[\t\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!text) return EMPTY_CELL;
  if (maxWidth === undefined || text.length <= maxWidth) return text;
  // Cut on a word boundary where one is close by, so the tail stays readable.
  const clipped = text.slice(0, maxWidth);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > maxWidth * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

export function renderSearchTable<T>(table: SearchTable<T>): string {
  const { columns, rows, summary = [], cursor, format = 'compact' } = table;
  const fields = columns.map((column) => column.header);
  const cells = rows.map(
    (row) => columns.map((column) => cell(column.value(row), column.maxWidth)),
  );

  if (format === 'compact-json') {
    return JSON.stringify({
      ...(summary.length > 0 ? { summary } : {}),
      fields,
      rows: cells,
      ...(cursor === undefined ? {} : { cursor }),
    });
  }

  const lines: string[] = [];
  if (summary.length > 0) lines.push(...summary, '');
  lines.push(fields.join('\t'));
  for (const row of cells) lines.push(row.join('\t'));
  if (cursor !== undefined) {
    lines.push('', `More results available — pass cursor: ${cursor}`);
  }
  return lines.join('\n');
}

/**
 * `1.234 of 5.678` style counts. German grouping matches how every upstream
 * portal reports its own totals, so a returned figure reads the same as the one
 * on the source's own result page.
 */
export function formatHitCount(shown: number, total?: number): string {
  const grouped = (value: number): string => value.toLocaleString('de-DE');
  return total === undefined || total <= shown
    ? `${grouped(shown)} results`
    : `${grouped(shown)} of ${grouped(total)} results`;
}
