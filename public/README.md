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
<!-- BECK_START -->
| [Beck Online](https://beck-online.beck.de) | ✅ Available | `beck:` | Required (subscription) |
<!-- BECK_END -->
| [Gesetze im Internet](https://www.gesetze-im-internet.de) | ✅ Available | `gii:` | None (public) |
| [Rechtsprechung im Internet](https://www.rechtsprechung-im-internet.de) | ✅ Available | `rii:` | None (public) |
| [InfoCuria (CJEU)](https://infocuria.curia.europa.eu) | ✅ Available | `icu:` | None (public) |
| [EUR-Lex](https://eur-lex.europa.eu) | ✅ Available | `eul:` | None (public) |

## Features

<!-- BECK_START -->
### Beck Online (`beck:*` tools)
- **Structured TOC as JSON** — table of contents extracted as machine-readable JSON with hierarchy, Randnummern, and short vpaths
- **Automatic session management** — persistent login with cookie storage, auto-retry on session expiration (max 2 attempts)
- **Campus license detection** — works with both credential-based login and institutional access
- **Two-phase document retrieval** — outline first, then sections on demand (avoids context pollution)
- **Pandoc-compatible Markdown** — `[Rn. 5]{.rn}`, `[S. 110]{.page}`, `[^1]` footnotes
- **Citation metadata extraction** — author, journal, court, file number, Zitiervorschläge
- **Hierarchical TOC navigation** — ancestors, siblings, children with vpaths
- **Persistent file cache** — 24h TTL, survives restarts (`GLMCP_BECK_CACHE=file`)
- Search laws, cases, commentaries, and articles
- Direct legislation lookup (e.g., "BGB § 823")
- Citation resolution and autocomplete
- Related content discovery (commentaries, case law for a norm)

<!-- BECK_END -->
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
<!-- BECK_START -->
| `GLMCP_BECK_ENABLED` | Auto | Beck Online. Auto-enabled with credentials, auto-disabled without. Set `true` for IP-based access. |
<!-- BECK_END -->
| `GLMCP_GII_ENABLED` | `true` | Gesetze im Internet |
| `GLMCP_RII_ENABLED` | `true` | Rechtsprechung im Internet |
| `GLMCP_ICU_ENABLED` | `true` | InfoCuria (CJEU) |
| `GLMCP_EUL_ENABLED` | `true` | EUR-Lex |

<!-- BECK_START -->
### Beck Online Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `GLMCP_BECK_USERNAME` | For Beck tools | Beck Online account username |
| `GLMCP_BECK_PASSWORD` | For Beck tools | Beck Online account password |
| `GLMCP_BECK_USE_PERSISTED_AUTH` | No | Reuse saved session cookies across restarts (default: `false`, always login fresh) |
| `GLMCP_BECK_CACHE` | No | Cache backend: `memory` (default) or `file` (persistent, survives restarts) |
| `GLMCP_BECK_CACHE_TTL` | No | Cache TTL in seconds (default: `604800` = 7 days) |
| `GLMCP_BECK_HEADLESS` | No | Set to `false` to show the browser window (default: headless) |
| `GLMCP_BECK_HUMANIZER` | No | Enable human-like behavior to avoid rate limits (default: `true`). Set to `false` to disable delays. |
| `GLMCP_BECK_MIN_DELAY` | No | Minimum delay between actions in ms (default: `500`) |
| `GLMCP_BECK_MAX_DELAY` | No | Maximum delay between actions in ms (default: `2000`) |
| `GLMCP_BECK_RATE_LIMIT` | No | Minimum time between requests in ms (default: `1000`) |

**Human-like behavior** (enabled by default): Context-aware delays that mimic natural browsing patterns:
- First visit: 5-10s (initial page load + orientation)
- Sequential navigation (prev/next): 2-4s (quick browsing within same document)
- TOC jumps/different documents: 4-8s (reading + decision making)
- Search results: 3-5s (reviewing + selecting)

Also includes:
- Manual stealth techniques (removes `navigator.webdriver`, adds `window.chrome`)
- Mouse movements and scrolling simulation
- Regular view for browsing (print view only for HTML format)
- Request queue to serialize concurrent requests
- 1s minimum between requests

**Rate Limiting**: If Beck Online's CAPTCHA is triggered, all requests are blocked until you restart the MCP server. This prevents continued hammering and gives Beck's rate limit time to clear (typically 5-10 minutes). Simply wait a few minutes, then restart your MCP client to resume.

<!-- BECK_END -->

## Tools

<!-- BECK_START -->
### Beck Online

| Tool | Description |
|------|-------------|
| `beck:get_related_content` | Related commentaries, handbooks, case law, and articles for a document ("Siehe auch" sidebar). |
| `beck:get_document` | Retrieve document content. Returns outline by default; use `section` for specific parts, `save_path` to save to file. |
| `beck:get_legislation` | Direct law lookup (e.g., BGB § 823). Same two-phase flow as `get_document`. |
| `beck:resolve_citation` | Resolve a citation string (e.g., "NJW 2024, 123") to a canonical vpath. |
| `beck:get_context` | Hierarchical TOC: ancestors, siblings (with vpaths), children, prev/next navigation. |
| `beck:get_toc` | Load a table of contents subtree. Primary use: exploring commentaries. |
| `beck:get_referenced_documents` | Deduplicated list of documents cited in a document, with type classification. |
| `beck:get_suggestions` | Autocomplete suggestions for a legal term. |
| `beck:search` | Search the database. Best practice: search just the norm number, then use `beck:get_related_content`. |

<!-- BECK_END -->
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

<!-- BECK_START -->
### Caching

Documents are cached after first fetch. Subsequent calls for outlines, sections, or referenced documents are served from cache without additional network requests.

| Backend | TTL | Capacity | Persistence | Config |
|---------|-----|----------|-------------|--------|
| `memory` (default) | 7 days | 50 docs | Session only | — |
| `file` | 7 days | 200 docs | `~/.local/share/german-legal-mcp/cache/` | `GLMCP_BECK_CACHE=file` |

TTL can be customized via `GLMCP_BECK_CACHE_TTL` environment variable (seconds). The file cache uses atomic writes, LRU eviction by mtime, and SHA-256 hashed filenames.

<!-- BECK_END -->
### Markdown Output

Documents are converted to pandoc-compatible Markdown:

- Randnummern: `[Rn. 5]{.rn}` (bracketed spans)
- Footnotes: `[^1]` references with `[^1]: text` definitions
<!-- BECK_START -->
- Page breaks: `[S. 110]{.page}` (enables pinpoint citations like "GRUR 2026, 107, 110")
<!-- BECK_END -->

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

<!-- BECK_START -->
**Scopes:** `beck`, `gii`, `rii`, `icu`, `eul`, `core`, `deps`, `config`
<!-- BECK_END -->
<!-- BECK_REPLACE_START
**Scopes:** `gii`, `rii`, `icu`, `eul`, `core`, `deps`, `config`
BECK_REPLACE_END -->

## Architecture

- **Dynamic provider loading** — providers auto-discovered from `src/providers/*/`
- **Cheerio + Turndown** for HTML → pandoc Markdown conversion
<!-- BECK_START -->
- **Puppeteer** for browser automation (handles OIDC auth, fingerprinting)
- **Pluggable cache** with `CacheBackend` interface (memory, file; extensible to Redis)
<!-- BECK_END -->
- **Zod** for input validation
- **Axios** for HTTP requests (GII, RII, InfoCuria, EUR-Lex)
<!-- BECK_START -->
- Tools namespaced by source (`beck:`, `gii:`, `rii:`, `icu:`, `eul:`)
<!-- BECK_END -->
<!-- BECK_REPLACE_START
- Tools namespaced by source (`gii:`, `rii:`, `icu:`, `eul:`)
BECK_REPLACE_END -->

## License

GPL-3.0 - See [LICENSE](LICENSE) for details.
