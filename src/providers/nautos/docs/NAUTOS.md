# nautos.de API Blueprint

> Reverse-engineered March 2026. Two separate API systems: the **nautos API** (`/api/v1/`) for search, metadata, and access control, and the **NV Viewer API** (`/api/nv/nv-rest/`) for document content delivery.
>
> This records portal observations, not current configuration defaults. The
> README/environment catalogue is the SSOT for the 4.0 implementation.

## Authentication

### nautos API (`/api/v1/`)

- **Auth**: `Authorization: Bearer {JWT}`
- **JWT source**: `POST /api/authentication/{tenantKey}` with empty JSON body `{}`
- **IP-based login**: No credentials needed — server authenticates by IP address
- **JWT TTL**: 12 hours (`exp - nbf = 43200s`), RS256 signed
- **Response**: `{ token, refreshToken, tenantId, userAccountId, username, forename, surname, email, roles, logoutOption, tenantKey, layoutLanguage, isIntranet, usedLoginMethod }`
- **Login method**: `usedLoginMethod: "IpAddressLogin"` (user-based auth to be set up later)
- **Refresh**: `POST /api/authentication/refresh` exists but frontend doesn't use it for IP-based auth (just re-logins). Likely for user-based auth only.
- **Tenant**: Hochschule Hannover - Bibliothek (`tenantKey: "DWW"`, `tenantId: "525d5a37-ecc1-4d0b-9ada-ad3b8fc20761"`)

### Authentication Methods (from JS bundle)

`GET /api/authentication/{tenantKey}` returns available login methods for a tenant.
Current DWW response: `{ "loginOption": "IPAddressLogin" }`.

| Method | Endpoint | Body | When |
|--------|----------|------|------|
| IP-based | `POST /api/authentication/{tenantKey}` | `{}` | `loginOption: "IPAddressLogin"` |
| User login | `POST /api/authentication` | `{ username, password, tenantName }` | `loginOption: "UserLogin"` (assumed) |
| LDAP | `POST /api/authentication/ldap` | `{ username, password, tenantName }` | `loginOption: "LdapLogin"` (assumed) |
| LDAP SSO | `POST /api/authentication/ldap/{tenantKey}` | `{}` (with cookies) | LDAP + SSO |
| SAML init | `POST /api/authentication/saml/{tenantKey}` | `{}` | SAML tenants |
| SAML complete | `POST /api/authentication/saml/{tenantKey}/login` | `{}` | After SAML redirect |
| Support | `POST /api/authentication/support` | `{ token, password }` | Support access |

All return the same response shape: `{ token, refreshToken, tenantId, userAccountId, ... }`.

**Implemented user-based auth**: `GLMCP_NAUTOS_USERNAME` and
`GLMCP_NAUTOS_PASSWORD` provide the credential fallback when IP/tenant access
does not authenticate.

### NV Viewer API (`/api/nv/nv-rest/`)

- **Auth**: `X-SHI-SECURITY: {xSHISecurity JWT}`
- **JWT source**: obtained via auth chain (see [Document Content Access Flow](#document-content-access-flow))
- **JWT type**: HS512, valid ~3 hours (observed: ~155 min remaining after auth)
- **JWT claims**: `sub` (OCTA token), `X-SHI-CONTEXT` ("octa"), `X-SHI-SUB` (""), `X-SHI-LANG` ("de"), `X-SHI-URL` ("https://nautos.de/api/nv/nv-rest/"), `X-SHI-FULLSCREEN` (false), `exp` (Unix timestamp)

## Key Identifiers

| ID | Example | Scope | Used for |
|----|---------|-------|----------|
| `acCode` | `DE30062916` | Document | Search results, metadata, detail page URL |
| `din21Id` | `235671251` | Document edition | Content access, NV viewer, lock |
| `fidasKey` | `30062916` | Document | Internal key |
| `edvNr` | `2325651` | Document | Internal identifier |
| `lockId` | UUID | Session | Concurrent access lock |
| `octaToken` | hex string (64 chars) | Session | NV viewer auth input. API returns `{octaToken:HEX}` — extract hex only |
| `xSHISecurity` | JWT | Session | NV viewer API auth header |
| `sectionId` | `sub-4.3`, `title.nat` | Section | Content lazy loading |

## Document Content Access Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: Search & Metadata  (Auth: Bearer JWT)                  │
│                                                                 │
│  POST /api/v1/search ──────────────────────────► acCode         │
│  GET  /api/v1/detail/{acCode} ─────────────────► metadata       │
│  POST /api/v1/documentaccess ──────────────────► din21Id        │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ Phase 2: Document Lock  (Auth: Bearer JWT)                      │
│                                                                 │
│  GET /api/v1/documentaccess/simultaneously/{din21Id} ► lockId   │
│  GET /api/v1/octa/token?din21id=&lockId= ──────► octaToken      │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ Phase 3: NV Viewer Auth  (no auth header)                       │
│                                                                 │
│  POST /api/nv/nv-rest/auth/user ───────────────► xSHISecurity   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ Phase 4: Document Content  (Auth: X-SHI-SECURITY)               │
│                                                                 │
│  GET /nv-rest/{din21Id}/toc ───────────────────► TOC JSON       │
│  GET /nv-rest/{din21Id}/doc?los=true ──────────► structure      │
│  GET /nv-rest/{din21Id}/doc?sectId=sub-1 ──────► section HTML   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## API Endpoints

### nautos API — Authentication

#### `POST /api/authentication/{tenantKey}`

IP-based login. Returns JWT + refresh token. No credentials needed.

**Headers**: `Content-Type: application/json`
**Request body**: `{}` (empty object)
**Response**:
```json
{
  "token": "eyJhbG...",
  "refreshToken": "base64...",
  "tenantId": "525d5a37-ecc1-4d0b-9ada-ad3b8fc20761",
  "userAccountId": "1dcd49e4-205a-4691-ab4f-330092e20c27",
  "username": "_ip_user_6df8370f-c07f-483d-9352-5cb785118757",
  "forename": "IP",
  "surname": "User",
  "email": "bib-it@hs-hannover.de",
  "roles": "ReadOnly,config_extended_search,...",
  "logoutOption": "NautosLogoutPage",
  "tenantKey": "DWW",
  "layoutLanguage": "de",
  "isIntranet": false,
  "usedLoginMethod": "IpAddressLogin"
}
```

**Notes**: JWT is RS256, 12h TTL. `userAccountId` needed for `/documentaccess` calls.

### nautos API — Search & Metadata

#### `POST /api/v1/search?pageSize=25&pageNumber=0&sortField=&sortDir=`

Search for standards by document number or keywords.

**Headers**: `Authorization: Bearer {JWT}`, `Content-Type: application/json`

**Request body**:
```json
{
  "documentNr": "DIN EN ISO 9001",
  "useDynamicSearch": false
}
```

All known search body fields (derived from UI form):

| Field | Type | Description |
|-------|------|-------------|
| `documentNr` | string | Document number (e.g. "DIN EN ISO 9001") |
| `fulltext` | string | Full text search term |
| `dateOfIssue` | object? | Date range (from/to, format "JJJJ-MM") |
| `documentType` | string? | Document type filter |
| `classificationIcs` | string? | ICS classification filter |
| `flagStatus` | string? | Status flag filter |
| `countryCode` | string? | Country code filter |
| `acCode` | string? | AC code filter |
| `useDynamicSearch` | boolean | Enable dynamic search |

Note: Only `documentNr` and `useDynamicSearch` have been observed in actual API calls. Other fields are inferred from the search form UI (`data-cy` attributes). Their exact API field names and types may differ.

**Response**:
```json
{
  "count": 15,
  "searchResultItems": [
    {
      "id": "DE30106815",
      "pos": 0,
      "score": 81.14,
      "documentNumber": "DIN EN ISO 9001",
      "dateOfIssue": "2025-09-00",
      "documentType": ["DC", "N-E", "WH"],
      "title": "Qualitätsmanagementsysteme - Anforderungen...",
      "titleDe": "...",
      "titleEn": "Quality management systems - Requirements..."
    }
  ]
}
```

**Notes**: `id` = `acCode`. `documentType` codes available via `GET /api/v1/documenttype`.

#### `GET /api/v1/detail/{acCode}`

Full document metadata.

**Response fields**: `id`, `documentNumber`, `dateOfIssue`, `documentType[]`, `titleDe`, `titleEn`, `valid` (bool), `fullTextDocument[]`, `ceInfo`, `version[]`, `linkLegislation[]`, `linkHandbook[]`, `classificationIcs`, flags (`flagAmendment`, `flagChanged`, `flagCNote`, `flagDeleted`, `flagHistorical`, etc.).

#### `POST /api/v1/documentaccess`

Check fulltext availability and get `din21Id`.

**Request body**:
```json
{
  "userId": "...",
  "acCodes": ["DE30062916"]
}
```

**Response**:
```json
[
  {
    "acCode": "DE30062916",
    "fulltexts": [
      {
        "id": "7d0f3d4f-7d7f-5156-90d8-6f290c18c260",
        "fidasKey": "30062916",
        "documentNumber": "DIN EN ISO 9001",
        "publicationDate": "2015-11-00",
        "din21Id": "235671251",
        "edvNr": "2325651",
        "language": "ml",
        "downloadable": true,
        "subscribable": true,
        "format": "XML",
        "isOwnedByUser": false,
        "acCode": "DE30062916",
        "url": "Nautos",
        "type": 0,
        "description": "DIN EN ISO 9001 (2015-11-00)"
      }
    ]
  }
]
```

**Notes**: `format` is `"XML"` or `"PDF"`. Only XML documents are viewable in the NV viewer. `din21Id` is the key for all content access.

#### `POST /api/v1/documentaccess/info`

Check access status for a document.

**Request**: `{"ids": ["235671251"]}`
**Response**: `{"accessInformations": {"235671251": "A"}}` — `"A"` = accessible.

### nautos API — Document Lock

#### `GET /api/v1/documentaccess/simultaneously/{din21Id}`

Acquire concurrent access lock.

**Response**: `"dd45a942-c50e-4e64-977f-303e4fa7c460"` (lockId as quoted string)

**Notes**: May block if a previous lock is still held. No explicit release endpoint found in the JS bundle — likely automatic timeout. The lock is per `din21Id` and per session.

#### `GET /api/v1/octa/token?din21id={din21Id}&lockId={lockId}`

Get OCTA token for NV viewer authentication.

**Response**: `"{octaToken:D9F6E3FFD412A901C3EFBDF34653E5EDE00011D23412264092813DB064FEF8D8}"` (quoted string, NOT JSON)

**⚠️ Format**: Response is a raw string `{octaToken:HEX}` (76 chars). Extract the 64-char hex value between `:` and `}`. The NV Viewer auth endpoint expects only the hex part, not the full wrapper.

### nautos API — Reference Data

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/documentstatus` | GET | All document status codes |
| `/api/v1/documenttype` | GET | All document type codes |
| `/api/v1/ics/icsKeys?key=03.120.10` | GET | ICS classification details |
| `/api/v1/subscriptions` | GET | User subscriptions |
| `/api/v1/tenants/{tenantId}` | GET | Tenant info |
| `/api/v1/configuration/searchresultlist` | GET | Available result list fields |
| `/api/v1/licenses/metadatawidth` | GET | Available metadata fields |

### NV Viewer API — Auth

#### `POST /api/nv/nv-rest/auth/user`

Exchange OCTA token for `xSHISecurity` JWT.

**Headers**: `Content-Type: application/json` (NO auth header)

**Request body**:
```json
{
  "isFullscreen": false,
  "token": "{octaToken}",
  "subuser": "",
  "contextid": "octa",
  "lang": "de",
  "url": "https://nautos.de/api/nv/nv-rest/"
}
```

**⚠️ The field is `token`, NOT `authToken`.**

**Response**:
```json
{
  "id": "octauser",
  "name": "OCTA Dummy USER",
  "login": 1773657192694,
  "xSHISecurity": "eyJhbGciOiJIUzUxMiJ9...",
  "lang": null,
  "authToken": "E18DDEC4...",
  "stamp": "{\"din21Id\":\"235671251\",\"stamp\":{\"tenant\":\"Hochschule Hannover - Bibliothek -\",\"dateTime\":\"2026-03-16T10:33:11.849455+00:00\",\"userName\":\"IP User\",\"withdrawn\":false,\"replacedBy\":[]}}"
}
```

### NV Viewer API — Document Content

All endpoints below use `X-SHI-SECURITY: {xSHISecurity}` header.

#### `GET /api/nv/nv-rest/{din21Id}/toc?lang=de`

Table of contents as JSON.

**Response** (24KB for DIN EN ISO 9001): JSON with `lang`, `head` (metadata, CSS links, lookup table), and TOC tree structure with section IDs and headings.

**Structure**:
```json
{
  "lang": "de",
  "head": {
    "meta": { "charset": "UTF-8" },
    "link": [
      { "rel": "stylesheet", "type": "text/css", "href": "/css/tr.css" },
      { "rel": "stylesheet", "type": "text/css", "href": "/css/tr_custom.css" }
    ],
    "lookup": [
      { "id": "nla-nat-1", "href": "#title.nat" }
    ]
  },
  "body": {
    "toc": {
      "id": "nav-techtoc",
      "section": [
        {
          "id": "title.nat",
          "label": "DIN EN ISO 9001",
          "title": "Qualitätsmanagementsysteme — Anforderungen — ...",
          "titleTooltip": "..."
        },
        {
          "id": "foreword.nat",
          "title": "Nationales Vorwort",
          "titleTooltip": "Nationales Vorwort",
          "section": [
            {
              "id": "sub-amendments",
              "data-top-level-id": "foreword.nat",
              "title": "Änderungen",
              "titleTooltip": "Änderungen"
            }
          ]
        },
        {
          "id": "sub-4",
          "label": "4",
          "title": "Kontext der Organisation",
          "titleTooltip": "Kontext der Organisation",
          "section": [
            {
              "id": "sub-4.1",
              "data-top-level-id": "sub-4",
              "label": "4.1",
              "title": "Verstehen der Organisation und ihres Kontextes",
              "titleTooltip": "..."
            }
          ]
        }
      ]
    }
  }
}
```

**Notes**: `head.lookup` maps internal IDs to section anchors (181 entries for DIN EN ISO 9001). `body.toc.section` is a recursive tree — each section may contain nested `section` arrays. Child sections have a `data-top-level-id` pointing to their parent chapter.

#### `GET /api/nv/nv-rest/{din21Id}/doc?los=true&onlyBody=false&highlight=&lang=de&isSlave=false&extractorActive=false&extractorType=false&provisionTypes=undefined`

Full document structure with section placeholders (no content).

**Response** (33KB):
```json
{
  "message": "",
  "type": "NONE",
  "content": "<root xmlns=\"http://din.com/xscore/content\" xml:id=\"nav-techtoc\">\n   <div class=\"loadonscroll title.nat\" data-section=\"title.nat\" data-chapter=\"title.nat\">...</div>\n   <div class=\"loadonscroll sub-1\" data-section=\"sub-1\" data-chapter=\"sub-1\">...</div>\n   ..."
}
```

**Notes**: Each `<div class="loadonscroll">` has `data-section` and `data-chapter` attributes. These are the section IDs for lazy loading.

#### `GET /api/nv/nv-rest/{din21Id}/doc?los=false&onlyBody=true&highlight=&sectId={sectionId}&lang=de&isSlave=false&extractorActive=false&extractorType=&provisionTypes=`

Fetch a single section's content.

**Response**:
```json
{
  "message": "",
  "type": "NONE",
  "content": "<!DOCTYPE div><div xmlns=\"http://www.w3.org/1999/xhtml\" class=\"tr--tr tr--standard-dot-din\"><div class=\"tr--clause\" lang=\"de\" id=\"sub-1\"><h1 class=\"tr--h1 annotate\"><span class=\"tr--label\">1</span>Anwendungsbereich</h1><div class=\"tr--content\">...</div></div></div>"
}
```

### NV Viewer API — Additional Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/nv-rest/config` | GET | Viewer configuration |
| `/nv-rest/exist?din21id={din21Id}` | GET | Check document exists |
| `/nv-rest/beuth/web/doc/meta?din21id={din21Id}` | GET | Document metadata |
| `/nv-rest/beuth/web/doc/meta/versions?din21id={din21Id}` | GET | Version history |
| `/nv-rest/{din21Id}/similar` | GET | Similar documents |
| `/nv-rest/{din21Id}/reference?sectid=` | GET | References |
| `/nv-rest/{din21Id}/doc/iswithdrawn` | GET | Withdrawal status |
| `/nv-rest/normviewer/resources/{din21Id}/{filename}?lang=de` | GET | Images/figures |
| `/nv-rest/auths` | POST | Authorization checks (per-action) |
| `/nv-rest/isPremiumAccess?din21id={din21Id}` | GET | Premium access check |
| `/nv-rest/shop/isBought?din21id={din21Id}` | GET | Purchase check |
| `/nv-rest/currentDoc?din21id={din21Id}` | GET | Current document info |
| `/nv-rest/xnotes?lang=de&din21id={din21Id}` | GET | User notes |
| `/nv-rest/xfavorites?din21id={din21Id}` | GET | User favorites |
| `/nv-rest/doccss?file=tr.css` | GET | Document stylesheet |

## Content HTML Structure

Section content uses XML/HTML with namespace `http://din.com/xscore/content` and semantic CSS classes:

| CSS Class | Meaning |
|-----------|---------|
| `tr--tr` | Root wrapper |
| `tr--standard-dot-din` | DIN standard type |
| `tr--profile-dot-nat` | National profile |
| `tr--clause` | Normative clause |
| `tr--annex` | Annex |
| `tr--h1` | Heading level 1 |
| `tr--label` | Section number label (e.g. "1", "A.1") |
| `tr--content` | Section body content |
| `tr--p` | Paragraph |
| `tr--ol-alphabetic` | Ordered list (alphabetic) |
| `tr--li` | List item |
| `tr--number` | Document number |
| `tr--date` | Publication date |
| `tr--titles` | Title block |
| `tr--title-dot-1` | Primary title |
| `tr--general-dot-title` | General title |
| `tr--sub-dot-title` | Subtitle |
| `tr--title-dot-text` | Title text (parenthetical) |
| `tr--title-dot-2` | Secondary title (other language) |
| `tr--classification` | ICS classification |
| `tr--descriptor` | Keywords |
| `tr--abstract` | Abstract |
| `tr--status` | Document status |
| `tr--list-dot-of-dot-documents` | Bibliography/references list |
| `tr--citation` | Citation to external standard (e.g. `ISO 9000:2015`) |
| `tr--reference` | Internal cross-reference (e.g. `Tabelle A.1`, `A.5`) |
| `tr--note` | Note/annotation block (contains `tr--non-normative-note-label`) |
| `tr--non-normative-note-label` | Note label (e.g. `ANMERKUNG 1:`) — always inside `tr--label` |
| `tr--table` | Table wrapper (with `id` like `tab-a.1`) |
| `tr--caption` | Table/figure caption |
| `tr--tgroup` | Table element (`<table>`) |
| `tr--row` | Table row |
| `tr--th` | Table header cell |
| `tr--entry` | Table body cell |
| `tr--hyphenate` | Hyphenation-enabled cell |
| `tr--ol-arabic` | Ordered list (numeric) |
| `tr--dt` | Definition term |
| `annotate` | Annotatable element (on headings, paragraphs, cells) |
| `<a id="de:...">` | Viewer-internal anchors (multiple per element) — strip |

### Locators / Pinpoint Citations

Unlike legal texts, DIN/ISO standards have **no Randnummern and no page numbers** in the HTML. The primary locator system is **clause numbers** (4.1, 8.5.1, A.1), already embedded in headings as `<span class="tr--label">`. The section ID system (`sub-4.1`) provides navigation via the TOC.

No special pandoc spans (`[Rn. 5]{.rn}`, `[S. 110]{.page}`) are needed. Converter focus:
- Clean structural conversion (headings with clause numbers, lists, tables)
- Notes (`tr--note`) → blockquotes with bold label (`> **ANMERKUNG 1:** ...`)
- Strip viewer-internal `<a id="de:...">` anchor spam
- Preserve `tr--citation` and `tr--reference` as plain text

## Section ID Naming Convention

| Pattern | Meaning | Example |
|---------|---------|---------|
| `title.nat` | National title page | |
| `foreword.nat` | National foreword | |
| `sub-amendments` | Amendments | |
| `sub-previous.edition` | Previous editions | |
| `title.reg` | Regional (European) title | |
| `foreword.reg` | Regional foreword | |
| `title.int` | International title | |
| `foreword.int` | International foreword | |
| `sub-endorsement.notice` | Endorsement notice | |
| `introduction.int` | International introduction | |
| `sub-{N}` | Main clause | `sub-1`, `sub-4.3`, `sub-8.5.1` |
| `sub-{letter}` | Annex | `sub-a`, `sub-b` |
| `sub-{letter}.{N}` | Annex subsection | `sub-a.1`, `sub-a.7` |
| `sub-annex.bibliography.int` | Bibliography | |
| `sub-na` | National annex | |

## Frontend URL Patterns

- Detail page: `https://nautos.de/{tenantKey}/search/item-detail/{acCode}`
- Search page: `https://nautos.de/{tenantKey}/search`
- NV Viewer (iframe): `https://nautos.de/api/nv/doc?contextid=octa&lang=de&din21id={din21Id}`

## Implementation Notes

### Provider Design

- **Pure REST API** — no browser automation needed. Use Axios.
- **Two-phase document retrieval** — outline first (TOC + metadata), then sections on demand (matches existing project pattern).
- **Auth chain is 5 steps** — cache the `xSHISecurity` JWT (valid ~3h) to avoid repeating the full chain for every request.
- **Identity-scoped caching** — cache document data beneath an opaque scope
  derived from tenant, account and optional `GLMCP_NAUTOS_ENTITLEMENT_ID`.
  Pre-4.0 unbound entries are never read as current.
- **Content conversion** — Cheerio + Turndown, as in the other HTML-sourced providers. The semantic CSS classes map cleanly to Markdown headings, lists, paragraphs.

### Auth Token Lifecycle

```
POST /api/authentication/{tenantKey} {} ─► JWT (12h TTL, RS256)
  └─► lockId                               — per-document session
       └─► octaToken                        — per-document session
            └─► xSHISecurity                — ~3 hour TTL (HS512 JWT)
```

Cache strategy: store `xSHISecurity` per `din21Id`, refresh when expired (check `exp` claim before use).

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GLMCP_NAUTOS_ENABLED` | No | Explicit override; otherwise auto-enabled when tenant or user credentials exist. |
| `GLMCP_NAUTOS_TENANT_KEY` | For IP-based access | Tenant key; no institution-specific default is embedded. |
| `GLMCP_NAUTOS_TENANT_ID` | No | Tenant ID, detected from authentication when available. |
| `GLMCP_NAUTOS_USERNAME` | For user access | Account username. |
| `GLMCP_NAUTOS_PASSWORD` | With username | Account password; secret. |
| `GLMCP_NAUTOS_ENTITLEMENT_ID` | No | Stable non-secret licence identity added to the cache partition. |

For IP-based access, the JWT is obtained automatically through the configured
tenant. User credentials are the fallback. Cached licensed content is bound to
the derived entitlement identity in both cases.

### Implemented tools

| Tool | Description |
|------|-------------|
| `nautos_search` | Search standards by document number or keywords |
| `nautos_get_document` | Two-phase: outline (TOC + metadata) first, then sections via `section` param |

### Open Questions

- **Lock release**: No explicit release endpoint found in the JS bundle. Likely automatic timeout. During testing, requesting a new lock while a previous one is held caused the request to hang/block. May need to manage lock lifecycle carefully.
- **Token refresh**: `POST /api/authentication/refresh` exists but frontend doesn't use it for IP-based auth — just calls `logout()` on expiry and re-logins. Refresh body format unknown, likely for user-based auth only. With 12h TTL, re-login is trivial.
- **Search facets**: Only `documentNr` + `useDynamicSearch` observed in actual API calls. Other fields inferred from UI form (`fulltext`, `dateOfIssue`, `documentType`, `classificationIcs`, `flagStatus`, `countryCode`, `acCode`). Exact API field names and types need verification.
- **PDF documents**: Some documents have `format: "PDF"` — are these viewable via a different mechanism?
- **Rate limits**: Unknown. Be conservative.
