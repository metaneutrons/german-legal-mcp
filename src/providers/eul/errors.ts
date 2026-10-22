import { PermanentError } from '../../shared/errors.js';

/** The upstream answered with an AWS WAF bot challenge instead of a document. */
export class EulBotChallengeError extends PermanentError {
  override readonly code: string = 'UPSTREAM_BOT_CHALLENGE';
  override readonly userMessage: string = 'The EU Publications Office answered with a bot challenge instead of the document.';
  override readonly recoveryHint: string = 'This is not a missing document. Retry later; if it persists, the MCP server needs an update. '
    + 'Meanwhile open the EUR-Lex link in a browser.';

  constructor(url: string) {
    super(`AWS WAF challenge instead of a document from ${url}`);
  }
}

/** Cellar holds no XHTML/HTML manifestation for this CELEX and language. */
export class EulDocumentNotFoundError extends PermanentError {
  override readonly code: string = 'NOT_FOUND';
  override readonly userMessage: string;
  override readonly recoveryHint: string = 'Check the CELEX number (eul_search finds it by title). Consolidated versions need '
    + 'their date suffix, e.g. "02016R0679-20160504", or the bare "0…" CELEX for the latest one. '
    + 'Some documents exist only in a subset of languages or only as PDF.';

  constructor(celex: string, language: string) {
    super(`Cellar has no XHTML/HTML text for CELEX ${celex} in language ${language}.`);
    this.userMessage = `No text found for CELEX ${celex} in language ${language}.`;
  }
}
