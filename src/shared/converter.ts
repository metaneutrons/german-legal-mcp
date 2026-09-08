import TurndownService from 'turndown';

/**
 * Base Turndown service for legal HTML → Markdown conversion.
 * Providers extend this with their own rules.
 */
export function createBaseTurndownService(): TurndownService {
  return new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });
}

/**
 * Post-process Markdown: clean up artifacts, normalize whitespace.
 */
export function postProcessMarkdown(body: string): string {
  let processed = body;
  processed = processed.replace(/(^|\n)\[(\d+)\]/g, '$1[Rn. $2]{.rn}');
  processed = processed.replace(/\n{3,}/g, '\n\n');
  processed = processed.replace(/\[\]\(null\)/g, '');
  return processed.trim();
}

const MIN_CONTENT_LENGTH = 20;

/**
 * Validate that HTML→Markdown conversion produced meaningful output.
 * Throws if the result is empty or suspiciously short, indicating the
 * upstream HTML structure may have changed.
 */
export function validateConversion(markdown: string, source: string): void {
  const stripped = markdown.replace(/^#[^\n]*\n/gm, '').replace(/\*\*[^*]+\*\*/g, '').trim();
  if (stripped.length < MIN_CONTENT_LENGTH) {
    throw new Error(
      `${source} returned HTML that produced no meaningful content after conversion. ` +
      `Their page structure may have changed. Please report this issue.`
    );
  }
}
