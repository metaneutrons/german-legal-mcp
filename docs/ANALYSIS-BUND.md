# technical Analysis: German Federal Law & Case Law Portals

**Date:** 2026-02-04
**Portals:** 
- [Legislation: gesetze-im-internet.de](https://www.gesetze-im-internet.de)
- [Case Law: rechtsprechung-im-internet.de](https://www.rechtsprechung-im-internet.de)

---

## 1. gesetze-im-internet.de (GII)

### Data Indexing
*   **Global TOC:** `https://www.gesetze-im-internet.de/gii-toc.xml`
    - Contains a list of all laws with their technical abbreviations (slugs) and links to XML zip files.
*   **Law Landing Page:** `https://www.gesetze-im-internet.de/[slug]/index.html`
    - Example: `https://www.gesetze-im-internet.de/bgb/index.html`
*   **Full Text (Single Page):** `https://www.gesetze-im-internet.de/[slug]/BJNR[ID].html`
    - This is the "complete version" (Gesamt-PDF/HTML).

### URL Pattern for Sections
*   Individual paragraphs (Einzelnormen) follow a predictable pattern:
    - `https://www.gesetze-im-internet.de/[slug]/__[number].html`
    - Example: `https://www.gesetze-im-internet.de/bgb/__1.html`
    - Note: Special characters in section numbers (like § 1a) are typically handled as `__1a.html`.

### Extraction & HTML Structure
*   **Main Content:** Usually inside `<div id="content">`.
*   **Headers:** `<h1>` contains the section number and title.
*   **Text Blocks:** Wrapped in `<div class="jurAbsatz">`.
*   **Footnotes:** Found at the end of the page, often in a specific table or list.
*   **Clean Version (XML):** Every law has a corresponding XML zip at `https://www.gesetze-im-internet.de/[slug]/xml.zip`. This is preferred for deep parsing as it avoids HTML layout issues.

---

## 2. rechtsprechung-im-internet.de (RII)

### Navigation & Search
*   **Search Portal:** `https://www.rechtsprechung-im-internet.de/jportal/portal/page/bsjrsprod.psml`
*   **System:** Uses the "jportal" system (shared with juris.de).
*   **Direct Access (Deep Links):**
    - Pattern: `https://www.rechtsprechung-im-internet.de/jportal/?docId=[ID]`
    - Supported IDs: ECLI (European Case Law Identifier) or internal Juris IDs.
    - Example: `https://www.rechtsprechung-im-internet.de/jportal/?docId=ECLI:DE:BGH:2023:280126UIIZR228.23.0`

### Search Parameters (Inferred from jportal)
*   The portal typically accepts the following parameters via POST or GET (depending on session):
    - `searchText`: Full-text search.
    - `court`: Court abbreviation (BGH, BVerwG, etc.).
    - `fileNumber`: Aktenzeichen (Case number).
    - `date`: Decision date.

### Extraction & HTML Structure
*   **Container:** Content is typically found in `<div class="jportal-container">` or `<div id="jurText">`.
*   **Text Blocks:** Similar to GII, paragraphs are often wrapped in `<div class="jurAbsatz">`.
*   **Metadata:** Title, Court, Date, and Case Number are usually presented in a table or header at the top of the decision text.

---

## 3. Markdown Conversion Strategy

### Mapping Table
| HTML Element | Markdown Equivalent | Notes |
|--------------|---------------------|-------|
| `<h1>`, `<h2>` | `#`, `##` | Use for Law Name and Section Number. |
| `<div class="jurAbsatz">` | `

` (Paragraph) | Maintain newlines between blocks. |
| `<b>`, `<strong>` | `**` | Often used for highlighting within text. |
| `<i>`, `<em>` | `*` | |
| `<a>` | `[Text](Url)` | Resolve relative URLs against the base domain. |
| `<sup>` | `^` | For footnote references. |

### Link Handling
*   **Internal GII Links:** Replace relative links (e.g. `../bgb/__1.html`) with absolute links to `gesetze-im-internet.de`.
*   **Cross-Links (GII to RII):** These are rare on the public portals but should be preserved as deep links to the `jportal` URL.

---

## 4. MCP Implementation Recommendations

### Search Implementation
1.  **GII:** Use the `aktuell.html` or `gii-toc.xml` to build a local index of law abbreviations for instant lookup.
2.  **RII:** Use the search form at `bsjrsprod.psml`. Since it is a dynamic portal, it may require a `User-Agent` that mimics a browser and potentially handling a session cookie.

### Extraction Implementation
*   **GII:** Preferred method is downloading the `xml.zip`, unzipping, and parsing the XML. It provides the cleanest structure.
*   **RII:** Scrape the HTML from the deep link (`?docId=...`). Focus on the core text div and strip the jportal navigation frame.

---
*Last Updated: 2026-02-04*
