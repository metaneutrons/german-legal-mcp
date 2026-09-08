/**
 * Generic section extraction from Markdown text.
 * Supports line ranges, Randnummer (Rn) ranges, and heading match.
 */
export function extractSection(text: string, section: string): string {
  const lines = text.split('\n');

  // Line range: "lines:100-200"
  const lineMatch = section.match(/^lines?:(\d+)-(\d+)$/i);
  if (lineMatch) {
    return lines.slice(Number(lineMatch[1] ?? 1) - 1, Number(lineMatch[2] ?? 1)).join('\n');
  }

  // Randnummer: "Rn 5" or "Rn 5-12" — matches `[Rn. N]{.rn}` spans in the text.
  const rnMatch = section.match(/^Rn\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?$/i);
  if (rnMatch) {
    const rnStart = Number(rnMatch[1] ?? 0);
    const rnEnd = rnMatch[2] ? Number(rnMatch[2]) : rnStart;
    let startIdx = -1;
    let endIdx = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i]?.match(/^\[Rn\.\s*(\d+)\]\{\.rn\}/);
      if (!m) continue;
      const rn = Number(m[1] ?? 0);
      if (rn === rnStart && startIdx === -1) startIdx = i;
      if (rn > rnEnd && startIdx !== -1) { endIdx = i; break; }
    }
    if (startIdx === -1) return `Randnummer "${section}" not found.`;
    return lines.slice(startIdx, endIdx).join('\n');
  }

  // Heading match: find section by text, end at next heading of same/higher level
  const needle = section.toLowerCase();
  const startIdx = lines.findIndex(l => l.toLowerCase().includes(needle));
  if (startIdx === -1) return `Section "${section}" not found.`;

  const headingMatch = lines[startIdx]?.match(/^(#{1,6})\s/);
  const level = headingMatch?.[1]?.length ?? 99;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i]?.match(/^(#{1,6})\s/);
    if ((m?.[1]?.length ?? 99) <= level) { endIdx = i; break; }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}
