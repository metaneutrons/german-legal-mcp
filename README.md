# German Legal MCP Server

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.26-purple)](https://modelcontextprotocol.io/)

> **⚠️ WARNING: Work in Progress**  
> This project is currently under active development and **not production-ready**. APIs may change without notice, and features may be incomplete or unstable. Use at your own risk.

A Model Context Protocol (MCP) server for German legal research, providing unified access to multiple legal databases.

## Supported Sources

| Source | Status | Prefix | Authentication |
|--------|--------|--------|----------------|
| [Gesetze im Internet](https://www.gesetze-im-internet.de) | ✅ Available | `gii:` | None (public) |
| [Rechtsprechung im Internet](https://www.rechtsprechung-im-internet.de) | ✅ Available | `rii:` | None (public) |
| [InfoCuria (CJEU)](https://infocuria.curia.europa.eu) | ✅ Available | `icu:` | None (public) |
| [EUR-Lex](https://eur-lex.europa.eu) | ✅ Available | `eul:` | None (public) |

## Features

### Gesetze im Internet (`gii:*` tools)
- **All federal German laws** — BGB, StGB, GG, and thousands more
- **No authentication** — free public access, no rate limits
- **Resilient input** — accepts "§ 823", "823", "Art. 1", "Paragraph 51"
- **Pandoc-compatible Markdown** — clean conversion with Turndown
- **Save to file** — `save_path` parameter to avoid context pollution
- Direct legislation lookup by law abbreviation and section number

### Rechtsprechung im Internet (`rii:*` tools)
- **Federal court decisions** — BVerfG, BGH, BVerwG, BFH, BAG, BSG, BPatG (from 2010)
- **No authentication** — free public access
- **Full text search** — search across all federal court decisions
- **Kurztext/Langtext** — summary or full text via `part` parameter
- **Randnummern** — formatted as `[Rn. 5]{.rn}` (pandoc spans)
- **Save to file** — `save_path` parameter to avoid context pollution

### InfoCuria — CJEU (`icu:*` tools)
- **EU Court of Justice case law** — judgments, opinions, orders from CJEU and General Court
- **No authentication** — free public access via InfoCuria API
- **Multilingual** — documents available in all EU languages (default: DE)
- **Flexible case lookup** — accepts case numbers (C-476/17), CELEX numbers, or internal IDs
- **Randnummern** — formatted as `[Rn. 5]{.rn}`
- **Partial content** — `section` parameter for Rn ranges, headings, or line ranges
- **Save to file** — `save_path` parameter to avoid context pollution

### EUR-Lex (`eul:*` tools)
- **EU legislation** — directives, regulations, decisions, treaties (TFEU, TEU)
- **No authentication** — free public access via Cellar REST API and SPARQL
- **Multilingual** — documents available in all EU languages (default: DE)
- **CELEX lookup** — retrieve by CELEX number (e.g., "32016R0679" for GDPR)
- **SPARQL search** — search by title keywords, filter by resource type
- **Partial content** — `section` parameter for articles (Art. 5), headings, or line ranges
- **Save to file** — `save_path` parameter to avoid context pollution

## Quick Start with npx

```bash
npx @metaneutrons/german-legal-mcp
```

or add your MCP client config (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "german-legal": {
      "command": "npx",
      "args": ["-y", "@metaneutrons/german-legal-mcp"]
    }
  }
}
```

## Environment Variables

### Provider Enablement

| Variable | Default | Description |
|----------|---------|-------------|
| `GLMCP_GII_ENABLED` | `true` | Gesetze im Internet |
| `GLMCP_RII_ENABLED` | `true` | Rechtsprechung im Internet |
| `GLMCP_ICU_ENABLED` | `true` | InfoCuria (CJEU) |
| `GLMCP_EUL_ENABLED` | `true` | EUR-Lex |
## Tools

### Gesetze im Internet

| Tool | Description |
|------|-------------|
| `gii:get_legislation` | Retrieve a federal law section (e.g., BGB § 823). Accepts flexible input: "823", "§ 823", "Art. 1". Optional `save_path` to save to file. |

### Rechtsprechung im Internet

| Tool | Description |
|------|-------------|
| `rii:search` | Search for court decisions. Returns list with doc IDs, titles, and snippets. |
| `rii:get_decision` | Retrieve full text of a court decision by doc ID. `part`: K (Kurztext) or L (Langtext, default). Optional `save_path` to save to file. |

### InfoCuria — CJEU

| Tool | Description |
|------|-------------|
| `icu:search` | Search CJEU decisions and opinions. Returns case numbers, ECLI, dates, and document IDs. |
| `icu:get_document` | Retrieve full text by case number (C-476/17) or CELEX number. Supports `section` (Rn ranges, headings, line ranges) and `save_path`. |

### EUR-Lex

| Tool | Description |
|------|-------------|
| `eul:search` | Search EU legislation via SPARQL. Filter by type (directive, regulation, decision, treaty). |
| `eul:get_document` | Retrieve EU legislation by CELEX number (e.g., "32016R0679" for GDPR). Supports `section` (Art. 5, Artikel 5-10, headings, line ranges) and `save_path`. |

### Two-Phase Document Retrieval

All document tools use a two-phase approach to avoid flooding the LLM context:

1. **Outline** — first call returns title, metadata, table of contents, and a preview
2. **Section** — request specific parts by Randnummer, heading, or line range (served from cache)
3. **Save to file** — write full document to disk, return metadata only

Section formats: `"Rn 5"`, `"Rn 5-12"`, `"lines:100-200"`, or any heading text (fuzzy match).

### Markdown Output

Documents are converted to pandoc-compatible Markdown:

- Randnummern: `[Rn. 5]{.rn}` (bracketed spans)
- Footnotes: `[^1]` references with `[^1]: text` definitions

## Development

```bash
npm test              # Run tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

### Commit Convention

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) enforced via Husky + commitlint.

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`

**Scopes:** `gii`, `rii`, `icu`, `eul`, `core`, `deps`, `config`

## Architecture

- **Dynamic provider loading** — providers auto-discovered from `src/providers/*/`
- **Cheerio + Turndown** for HTML → pandoc Markdown conversion
- **Zod** for input validation
- **Axios** for HTTP requests (GII, RII, InfoCuria, EUR-Lex)
- Tools namespaced by source (`gii:`, `rii:`, `icu:`, `eul:`)

## License

GPL-3.0 - See [LICENSE](LICENSE) for details.
