<div align="center">

<img src="icon.png" alt="German Legal MCP" width="128" height="128">

# German Legal MCP Server

German, Austrian &amp; EU legal research — legislation, case law, parliamentary materials, literature and standards

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0) [![Node.js Version](https://img.shields.io/badge/node-%3E%3D24.0.0-brightgreen)](https://nodejs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)](https://www.typescriptlang.org/) [![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.30-purple)](https://modelcontextprotocol.io/)

</div>

> **4.0 status**
>
> Version 4.0.0 provides hardened provider contracts, application components,
> MCP projections and public/private distributions. The local release gates are
> designed to fail closed. Stable releases require an exact private/public
> commit binding, protected signed tags, digest-approved workflows, public
> GitHub/npm OIDC provenance and fresh live-contract evidence as defined by the
> release runbook and dated enterprise audit. Case-law search pages through
> every source that supports one and reports each source's own hit total.
> Third-party portals remain external operational dependencies; scheduled live
> contracts detect availability or response-shape drift. Subscription
> sources require valid credentials, licences or institutional access.

A Model Context Protocol (MCP) server for German, Austrian and EU legal
research, providing unified access to legislation, case law, parliamentary
materials, literature, preprints and technical standards.

The provider layer is also available as typed application components. Consumers
do not need to run MCP or parse tool output — they can consume normalized
federal and Länder case law directly:

```ts
import {
  CaseLawClient,
} from '@metaneutrons/german-legal-mcp/components/case-law';

const client = new CaseLawClient();
const page = await client.search({
  query: 'DSGVO Schadensersatz',
  resourceTypes: ['case-law'],
  jurisdictions: ['DE', 'DE-NW'],
  limit: 25,
});
```

Legislation uses the same application-facing model:

```ts
import {
  LegislationClient,
} from '@metaneutrons/german-legal-mcp/components/legislation';

const legislation = new LegislationClient();
const laws = await legislation.search({
  query: 'Datenschutzgesetz',
  resourceTypes: ['legislation'],
  jurisdictions: ['DE-NW'],
});
```

Shared provenance, rights, search and document types are exported from
`@metaneutrons/german-legal-mcp/contracts`. Every provider has a component entry
and a structured data client. The MCP tools use those same clients; MCP output
is only a presentation layer over the application contract.

Multi-domain databases return discriminated unions. For example, RIS exposes
one client for Austrian case law and legislation; narrow each result through
`resourceType` before using type-specific fields:

```ts
import { component as ris } from '@metaneutrons/german-legal-mcp/components/ris';

const client = ris.createDataClient();
const results = await client.search({ query: 'Datenschutz' });
for (const result of results.results) {
  if (result.resourceType === 'case-law') console.log(result.fileNumber);
  if (result.resourceType === 'legislation') console.log(result.eli);
}
```

Optional portable capabilities cover tables of contents, authentication and
operational status. RIS exposes native legislation TOCs. The German legislation
client reports a native TOC where the source supplies one and derives it from
the document otherwise. RII is case-law-only and does not advertise a TOC
capability.
Nautos implements TOC and authentication lifecycle capabilities while keeping
its session details behind the provider boundary.

## Supported Sources

| Source | Status | Prefix | Authentication |
|--------|--------|--------|----------------|
| Bundes- & Landesrecht | ✅ Available | `legis_` | None (public) |
| [Rechtsprechung im Internet](https://www.rechtsprechung-im-internet.de) | ✅ Available | `rii_` | None (public) |
| [RIS Österreich](https://www.ris.bka.gv.at) | ✅ Available | `ris_` | None (public OGD API) |
| [InfoCuria (CJEU)](https://infocuria.curia.europa.eu) | ✅ Available | `icu_` | None (public) |
| [EUR-Lex](https://eur-lex.europa.eu) | ✅ Available | `eul_` | None (public) |
| [DIP Bundestag](https://dip.bundestag.de) | ✅ Available | `dip_` | Public key included |
| [arXiv](https://arxiv.org) | ✅ Available | `arxiv_` | None (public) |
| [nautos.de](https://nautos.de) | ✅ Available | `nautos_` | Required (IP or credentials) |

## Features


### Bundes- & Landesrecht (`legis_*` tools)

- **Federal and state legislation** — BUND (all federal laws) + 16 Länder (all states)
- **No authentication** — free public access; the client defines no explicit request limit
- **Unified interface** — one set of tools for all jurisdictions
- **Full text search** — search across state legislation (Länder only)
- **Resilient input** — BUND accepts "§ 823", "823", "Art. 1", "Paragraph 51"
- **Pandoc-compatible Markdown** — clean conversion with Turndown
- **Save to file** — `save_path` parameter to avoid context pollution
- **Available states:** BUND, BB, BW, BY, BE, HB, HE, HH, MV, NI, NW, RP, SL, SN, ST, SH, TH

### Rechtsprechung im Internet (`rii_*` tools)

- **Federal court decisions** — BVerfG, BGH, BVerwG, BFH, BAG, BSG, BPatG (from 2010)
- **Bavarian state courts** — AG, LG, OLG, VG, VGH, FG, ArbG, LAG, BayVerfGH via gesetze-bayern.de
- **NRW state courts** — decisions from the official NRWE database via `source: "NW"`
- **Lower Saxony state courts** — decisions from NI-VORIS via `source: "NI"`
- **Brandenburg state courts** — decisions from the official Brandenburg decision database via `source: "BB"`
- **Bremen state courts** — official Bremen VG archive via `source: "HB"`; the Bremen index links separate OLG/OVG/VG/LAG portals, so coverage is explicitly partial until those portals expose a common search interface
- **Saxony state courts** — ESAMOSplus WebForms search for the OLG Dresden archive via `source: "SN"`
- **jPortal state courts** — Baden-Württemberg, Berlin, Hamburg, Hessen, Mecklenburg-Vorpommern, Rheinland-Pfalz, Saarland, Sachsen-Anhalt, Schleswig-Holstein and Thüringen via their official jPortal portals
- **Shared DecisionAdapter contract** — all new state sources normalize IDs, court, date, file number, ECLI, snippets and Markdown retrieval behind the same `rii_*` tools
- **Cross-portal search** — `source: "ALL"` searches every configured decision portal in parallel, deduplicates overlapping decisions, ranks the consolidated result list and reports unavailable portals
- **No authentication** — free public access
- **Full text search** — search across all federal court decisions
- **Kurztext/Langtext** — summary or full text via `part` parameter
- **Randnummern** — formatted as `[Rn. 5]{.rn}` (pandoc spans)
- **Save to file** — `save_path` parameter to avoid context pollution

### RIS Österreich (`ris_*` tools)

- **Austrian federal, state & case law** — broad Bundesrecht and Landesrecht collection search, plus Judikatur (OGH/OLG/LG via Justiz; VwGH, VfGH, BVwG and others via the `court` filter)
  - **Collection semantics:** `ris_search` can return consolidated norms (`BrKons`/`LrKons`) and authentic gazette publications; the returned `applikation` identifies the result type. A `bundesland` filter restricts Landesrecht to that state's consolidated law (`LrKons`). For state case law use `application="judikatur"` with the appropriate `court` (e.g. `Lvwg`), not `bundesland`.
- **Normalized application client** — `RisDataClient.search()` restricts legislation results to consolidated law and supports all 9 Bundesländer through normalized jurisdictions
- **No authentication** — free public Open Government Data REST API (`data.bka.gv.at/ris/api/v2.6`)
- **Latest-first** — `sort="date"` for the newest decisions; Judikatur Rechtssätze link their full decision text (Entscheidungstext) for `ris_get`
- **Navigate & read statutes** — `ris_toc law="ABGB"` lists the §§ with headings; `ris_get_norm law="ABGB" paragraph="1295"` returns a single §
- **Surgical retrieval** — `ris_get section=…` returns only a Randnummer (`Rn 5`), an Rn range (`Rn 5-9`), a line range (`lines:1-40`), or a heading (`Spruch`) — all token-preserving
- **Pandoc-compatible Markdown** — Randnummern as `[Rn. 5]{.rn}` spans; document HTML converted with Cheerio + Turndown
- **Structured metadata** — Geschäftszahl, Entscheidungsdatum, ECLI, issuing court/organ
- **Save to file** — `save_path` parameter to avoid context pollution
- ⚠️ **Austrian** law — for German case law use `rii_*`, for German legislation use `legis_*`

### InfoCuria — CJEU (`icu_*` tools)

- **EU Court of Justice case law** — judgments, opinions, orders from CJEU and General Court
- **No authentication** — free public access via InfoCuria API
- **Multilingual** — documents available in all EU languages (default: DE)
- **Flexible case lookup** — accepts case numbers (C-476/17), CELEX numbers, or internal IDs
- **Randnummern** — formatted as `[Rn. 5]{.rn}`
- **Partial content** — `section` parameter for Rn ranges, headings, or line ranges
- **Save to file** — `save_path` parameter to avoid context pollution

### EUR-Lex (`eul_*` tools)

- **EU legislation** — directives, regulations, decisions, treaties (TFEU, TEU)
- **No authentication** — free public access via Cellar REST API and SPARQL
- **Multilingual** — documents available in all EU languages (default: DE)
- **CELEX lookup** — retrieve by CELEX number (e.g., "32016R0679" for GDPR)
- **SPARQL search** — search by title keywords, filter by resource type
- **Partial content** — `section` parameter for articles (Art. 5), headings, or line ranges
- **Save to file** — `save_path` parameter to avoid context pollution

### DIP Bundestag (`dip_*` tools)

- **Parliamentary documents** — Bundestagsdrucksachen (Gesetzentwürfe, Beschlussempfehlungen, Anfragen)
- **Legislative processes** — Vorgänge with status tracking and linked documents
- **Debate transcripts** — full text search across Plenarprotokolle (BT and BR)
- **Full text retrieval** — extracted text including Gesetzesbegründungen, with section support
- **Public API key included** — works out of the box (key valid until end of May 2027, override via env var)
- **Save to file** — `save_path` parameter to avoid context pollution

### arXiv (`arxiv_*` tools)

- **Preprint search** — search by keywords, author, title, abstract, or category
- **Metadata + abstract** — default response without full text fetch (token-efficient)
- **HTML full text** — Markdown conversion for papers from ~2024+ (LaTeXML HTML)
- **PDF fallback** — older papers without HTML return abstract + PDF link
- **No authentication** — free public API; the client defines no explicit request limit (upstream usage policies still apply)
- **Save to file** — `save_path` parameter to avoid context pollution

### nautos.de (`nautos_*` tools)

- **DIN/EN/ISO standards** — search and retrieve technical standards from nautos.de
- **Two-phase document retrieval** — outline (metadata + TOC) first, then sections on demand
- **Automatic authentication** — IP-based login (auto-detected), user-based login fallback
- **Structured TOC** — hierarchical table of contents with section IDs for navigation
- **Identity-scoped file cache** — 30-day TTL, persistent across restarts under `<GLMCP_STATE_DIR>/cache/nautos/identities/`
- **Save to file** — `save_path` parameter to dump full document to disk

## Install in Claude Desktop (one-click bundle)

The easiest way to use this server in [Claude Desktop](https://claude.ai/download) is the packaged **MCP Bundle (`.mcpb`)** — no Node.js, no `npx`, no config file.

1. Download **[`german-legal-mcp.mcpb`](https://github.com/metaneutrons/german-legal-mcp/releases/latest/download/german-legal-mcp.mcpb)** from the [latest release](https://github.com/metaneutrons/german-legal-mcp/releases/latest).
2. In Claude Desktop open **Settings → Extensions** and drag the `.mcpb` onto the window (or use **Install…**).
3. Optionally set the DIP key or nautos credentials in the extension's settings — everything else works out of the box.

The bundle ships the public, no-authentication sources and is cross-platform (macOS and Windows, Apple Silicon and Intel) — Claude Desktop supplies the Node.js runtime, so a single download works everywhere.

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
| `GLMCP_STATE_DIR` | Platform default | Root directory for logs, sessions, caches, metrics, daemon sockets and locks. |
| `GLMCP_EXPORT_DIR` | `<GLMCP_STATE_DIR>/exports` | Exclusive root for files written through `save_path`; existing files and symlinked parents are refused. |
| `GLMCP_LOG_LEVEL` | `info` | Structured log level. |
| `GLMCP_LEGIS_ENABLED` | `true` | Bundes- & Landesrecht |
| `GLMCP_RII_ENABLED` | `true` | Rechtsprechung im Internet |
| `GLMCP_RIS_ENABLED` | `true` | RIS Austria (federal law + case law) |
| `GLMCP_ICU_ENABLED` | `true` | InfoCuria (CJEU) |
| `GLMCP_EUL_ENABLED` | `true` | EUR-Lex |
| `GLMCP_DIP_ENABLED` | `true` | DIP Bundestag (auto-disabled after 2027-06-01 without own key) |
| `GLMCP_DIP_API_KEY` | Public key | Override the bundled public API key |
| `GLMCP_ARXIV_ENABLED` | `true` | arXiv preprint search |
| `GLMCP_NAUTOS_ENABLED` | Auto | nautos.de. Auto-enabled with tenant key or credentials, auto-disabled without. |


### nautos.de Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `GLMCP_NAUTOS_TENANT_KEY` | For IP-based | Tenant key (e.g., `DWW`). Enables IP-based authentication. |
| `GLMCP_NAUTOS_USERNAME` | For user-based | nautos.de account username |
| `GLMCP_NAUTOS_PASSWORD` | For user-based | nautos.de account password |
| `GLMCP_NAUTOS_TENANT_ID` | No | Tenant ID (auto-detected from login response) |
| `GLMCP_NAUTOS_ENTITLEMENT_ID` | No | Optional stable, non-secret licence identity added to the tenant/account cache partition. Changing it intentionally creates a fresh cache identity. |

**Authentication**: IP-based login is tried first (requires `GLMCP_NAUTOS_TENANT_KEY`). If it fails and credentials are set, user-based login is attempted as fallback.



## Tools


### Bundes- & Landesrecht

| Tool | Description |
|------|-------------|
| `legis_search` | Search state legislation. Parameter: `query`, `state` (e.g., "BW", "BE"), `limit`. Länder search uses official portal/catalogue data with local normalization and reranking so common abbreviations and title queries (e.g. `VwVfG NRW`, `BbgVwVfG`, `BremVwVfG`) resolve to the root law before section hits. Note: BUND does not support search. |
| `legis_get` | Retrieve a specific law/norm. BUND: `id` = "law/section" (e.g., "bgb/823"). Länder: `id` from search results. Optional `save_path`. |
| `legis_toc` | Compact table of contents for a law — section numbers and headings. Supports `from`/`to` range and `depth` filter. BUND: `id` = law abbreviation (e.g., "bgb"). |
| `legis_states` | List available jurisdictions with implementation status. |

### Rechtsprechung im Internet

| Tool | Description |
|------|-------------|
| `rii_search` | Search for court decisions. `source` supports `BUND`, `BY`, `NW`, `NI`, `BB`, `HB`, `SN`, the jPortal state codes `BW`, `BE`, `HH`, `MV`, `RP`, `SL`, `ST`, `SH`, `TH`, `HE`, or `ALL` for a parallel cross-portal search. Note `BUND` is federal-only — state Arbeits-, Verwaltungs- and Oberlandesgerichte live in the state sources, so `ALL` is the right choice for a topic survey. With `ALL`, result slots are shared across the portals that matched and each portal's own hit total is reported. `page` pages every portal at once (BUND, HB and SN expose only their first page and say so); `collapse_duplicates` folds mass-litigation runs, naming what it folded. |
| `rii_get_decision` | Retrieve full text by doc ID. `part`: K (Kurztext) or L (Langtext, default) for BUND; optional `save_path` is supported for every source. For NRW, use the URL returned by `rii_search`; for jPortal, use its `doc_id`. |

### RIS Österreich

| Tool | Description |
|------|-------------|
| `ris_search` | Search the broad Austrian RIS Bundesrecht/Landesrecht collections or Judikatur (`court`: Justiz/Vwgh/Vfgh/Bvwg). Legislation hits may be consolidated (`BrKons`/`LrKons`) or authentic publications; inspect the returned `applikation`. `bundesland` restricts Landesrecht to that state's consolidated law. `sort="date"` returns the latest decisions first. Judikatur hits are Rechtssätze that link their full decision text for `ris_get`. |
| `ris_get` | Retrieve a RIS document as Markdown by `content_url` (from search) or `id` + `applikation`. `section` returns only part — `Rn 5`, `Rn 5-9`, `lines:1-40`, or a heading like `Spruch` — for token-preserving reads. Optional `save_path`. |
| `ris_get_norm` | Retrieve a single **§** of a consolidated law — `law="ABGB" paragraph="1295"`. `application`: bundesrecht (federal) or landesrecht (+ `bundesland`). The token-preserving way to read one paragraph. |
| `ris_toc` | Table of contents (Inhaltsverzeichnis) of a consolidated law — its §§ with headings — to navigate before `ris_get_norm`. `law="ABGB"` (full title if an abbreviation fails). `application` + `bundesland` as above. |

### InfoCuria — CJEU

| Tool | Description |
|------|-------------|
| `icu_search` | Search CJEU decisions and opinions. Returns case numbers, ECLI, dates, and document IDs. |
| `icu_get_document` | Retrieve full text by case number (C-476/17) or CELEX number. Supports `section` (Rn ranges, headings, line ranges) and `save_path`. |

### EUR-Lex

| Tool | Description |
|------|-------------|
| `eul_search` | Search EU legislation via SPARQL. Filter by type (directive, regulation, decision, treaty). |
| `eul_get_document` | Retrieve EU legislation by CELEX number (e.g., "32016R0679" for GDPR). Supports `section` (Art. 5, Artikel 5-10, headings, line ranges) and `save_path`. |

### DIP Bundestag

| Tool | Description |
|------|-------------|
| `dip_search` | Search Bundestagsdrucksachen by title. Filter by type (Gesetzentwurf, Anfrage, etc.), Wahlperiode, date range. |
| `dip_get` | Retrieve full text of a Drucksache by Dokumentnummer (e.g., "19/27426"). Supports `section` and `save_path`. |
| `dip_search_vorgang` | Search legislative processes (Vorgänge) with status and linked Drucksachen. |
| `dip_search_plenarprotokoll` | Full text search across parliamentary debate transcripts (BT and BR). |

### arXiv

| Tool | Description |
|------|-------------|
| `arxiv_search` | Search preprints by keywords, author, title, abstract, or category. Returns metadata + abstract. |
| `arxiv_get` | Retrieve paper by arXiv ID. Default: metadata + abstract. With `section` or `save_path`: HTML full text as Markdown (~2024+, older: PDF link). |

### nautos.de

| Tool | Description |
|------|-------------|
| `nautos_search` | Search DIN/EN/ISO standards by document number. Returns acCode, title, date, type. |
| `nautos_get_document` | Retrieve standard by acCode. Returns outline (metadata + TOC) by default; use `section` for specific parts, `save_path` to save full document. |

### Token-Efficient Document Retrieval

Retrieval behavior is explicit and provider-specific:

1. **Outline-first** — Nautos returns metadata and a table of contents before
   sections or full-file output are requested.
2. **Focused reads** — tools that advertise `section` accept the selectors
   documented in their tool description, such as Randnummer, heading, line or
   article ranges. Selector formats are not assumed across every provider.
3. **File output** — every tool that advertises `save_path` requires an
   absolute path inside `GLMCP_EXPORT_DIR`. Existing targets, symbolic-link
   parents and paths outside that root are refused; successful writes create
   private directories/files. If that tool also supports `section`, it writes
   the requested section rather than the complete document.

Other retrieval tools return their documented direct response; for example,
arXiv returns metadata and the abstract by default. They are not implicitly
converted to the outline-first flow.

### Markdown Output

Documents are converted to pandoc-compatible Markdown:

- Randnummern: `[Rn. 5]{.rn}` (bracketed spans)
- Footnotes: `^[inline footnote text]` (pandoc inline footnotes)

## Development

```bash
npm test              # Run tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
npm run verify        # Complete deterministic release gate
```

### Live provider contracts

The default suite never uses the network. Opt-in live contracts validate the
current upstream response through the same normalized data clients consumed by
applications:

```bash
npm run test:live:public
```

This runs search → normalized reference → document for the public providers and
for every configured German case-law and legislation source. TOC-capable
legislation sources are checked as well. Gesetze im Internet is the documented
exception: it has no search API, so the live contract retrieves `bgb/823`
directly and validates the BGB TOC separately.

Live output contains only source, document identifier, title, resource type and
content length. Full text is asserted in memory and is never written as a test
report or CI artifact.


### MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/bin/german-legal-mcp.js
```

### Commit Convention

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) enforced via Husky + commitlint.

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`

**Scopes:** `legis`, `rii`, `ris`, `icu`, `eul`, `dip`, `nautos`, `core`, `deps`, `config`

## Architecture

- **Manifest-driven providers** — startup, help, shutdown and public/private
  distribution use one checked provider manifest

- **Cheerio + Turndown** for HTML → pandoc Markdown conversion

- **Zod** for input validation
- **Axios** for HTTP requests (Legis, RII, RIS, InfoCuria, EUR-Lex, DIP, arXiv, nautos)
- **Structured JSON errors** — all providers return `BaseError.toJSON()` with `code`, `userMessage`, `recoveryHint`; Axios errors auto-wrapped; DNS failures fail fast
- **Conversion validation** — all HTML→Markdown providers validate output is non-empty; detects upstream layout changes early

- Tools namespaced by source (`legis_`, `rii_`, `ris_`, `icu_`, `eul_`, `dip_`, `arxiv_`, `nautos_`)

## License

GPL-3.0 - See [LICENSE](LICENSE) for details.
