/** Encode untrusted text as one SPARQL string literal. */
export function sparqlStringLiteral(value: string): string {
  return JSON.stringify(value);
}

/** Return a strict Gregorian YYYY-MM-DD value for an xsd:date literal. */
export function isoDateLiteral(value: string): string {
  const date = value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid ISO date: ${JSON.stringify(value)}`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid ISO date: ${JSON.stringify(value)}`);
  }
  return date;
}
