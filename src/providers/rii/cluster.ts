import type { SourcedDecisionSearchResult } from './types.js';

/**
 * Collapse runs of decisions that differ only in their file number.
 *
 * Mass litigation dominates German case-law search. A live "Schadensersatz"
 * search of the federal courts returned 25 hits of which 11 were the BGH's
 * Diesel emissions series, every one opening "Der Kläger nimmt die Beklagte
 * wegen der Verwendung unzulässiger Abschalteinrichtungen in einem Kraftfahrzeug
 * auf Schadensersatz in Anspruch." Listing all eleven costs tokens and tells the
 * reader less than "one of these, plus ten more like it" does.
 *
 * Grouping is deliberately conservative — same court, and the same opening
 * clause once numbers and case-specific detail are stripped. Two decisions from
 * one court on genuinely different questions keep their own rows.
 */

export interface DecisionCluster {
  /** Newest member, shown as the row. */
  readonly representative: SourcedDecisionSearchResult;
  /** Members collapsed into the representative, newest first. */
  readonly collapsed: readonly SourcedDecisionSearchResult[];
}

/** How much of the opening clause has to agree before two hits are one story. */
const SIGNATURE_LENGTH = 90;
/** Below this, a cluster is not worth the reader's attention. */
const MINIMUM_CLUSTER = 3;

/**
 * Reduce a hit to what makes it *the same case type* as another.
 *
 * Digits go first: file numbers, dates, amounts and paragraph numbers are
 * exactly what varies between otherwise identical boilerplate judgments.
 */
function signature(result: SourcedDecisionSearchResult): string {
  const opening = `${result.title} ${result.snippet ?? ''}`
    .toLocaleLowerCase('de-DE')
    .replace(/[\d.,§/-]+/g, ' ')
    .replace(/[^\p{Letter}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${(result.court ?? '').toLocaleLowerCase('de-DE')}|${opening.slice(0, SIGNATURE_LENGTH)}`;
}

function sortableDate(date: string): string {
  const german = date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (german) return `${german[3]}-${german[2]}-${german[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : '';
}

/**
 * Group near-identical results, preserving the order in which each group's
 * representative first appeared so ranking is not disturbed.
 *
 * Groups smaller than `MINIMUM_CLUSTER` are emitted as individual rows: hiding
 * one or two decisions behind a "+N more" note would cost the reader more than
 * it saves.
 */
export function clusterDecisions(
  results: readonly SourcedDecisionSearchResult[],
): DecisionCluster[] {
  const groups = new Map<string, SourcedDecisionSearchResult[]>();
  for (const result of results) {
    const key = signature(result);
    const existing = groups.get(key);
    if (existing) existing.push(result);
    else groups.set(key, [result]);
  }

  const clusters: DecisionCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < MINIMUM_CLUSTER) {
      for (const member of members) clusters.push({ representative: member, collapsed: [] });
      continue;
    }
    const [newest, ...rest] = [...members].sort(
      (a, b) => sortableDate(b.date).localeCompare(sortableDate(a.date)),
    );
    clusters.push({ representative: newest!, collapsed: rest });
  }
  return clusters;
}

/**
 * One line per cluster naming what was folded away, so a collapsed group is
 * always visible as a decision the caller can undo — never a silent omission.
 */
export function describeClusters(clusters: readonly DecisionCluster[]): string[] {
  return clusters
    .filter((cluster) => cluster.collapsed.length > 0)
    .map((cluster) => {
      const numbers = cluster.collapsed
        .map((member) => member.fileNumber)
        .filter((value): value is string => Boolean(value));
      const listed = numbers.slice(0, 4).join(', ');
      const rest = numbers.length > 4 ? `, +${numbers.length - 4} more` : '';
      return `${cluster.collapsed.length} further near-identical `
        + `${cluster.representative.court ?? cluster.representative.source} decision(s) collapsed`
        + (listed ? `: ${listed}${rest}` : '');
    });
}
