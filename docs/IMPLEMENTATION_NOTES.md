# Beck Online MCP Server - Implementation Notes

**Date:** 2026-02-04
**Project:** `beck-online-mcp`

---

## 1. Architectural Decisions

### Browser-Based Client (Puppeteer)
We chose Puppeteer (Headless Chrome) over a lightweight HTTP client (like Axios) for three critical reasons:
1.  **OIDC Redirect Loops:** The authentication flow involves complex cross-domain redirects (`beck-online` -> `account.beck.de` -> `beck-online`) with strict Correlation/Nonce cookie checks. Standard clients often fail to persist state correctly across these jumps or strip headers, leading to infinite redirect loops. The browser handles this natively.
2.  **Fingerprinting:** Beck Online uses `FingerprintJS` (v5.0.1) to detect bots. Puppeteer provides a valid execution environment (Canvas, WebGL, AudioContext) that passes these checks automatically.
3.  **JavaScript Execution:** Some search features (e.g., generating the complex Gzipped `QUERY` parameter) rely on client-side logic.

### Singleton Pattern
To ensure performance:
*   The `BeckBrowser` class is a singleton.
*   The browser instance is launched **once** upon the first request.
*   The session (cookies) is preserved in memory.
*   Subsequent requests reuse the open page, making them extremely fast (milliseconds vs. seconds).

### Graceful Shutdown
The server listens for `SIGINT`, `SIGTERM`, and `stdin` closure to ensure the Chrome process is killed. This prevents "zombie" browser processes from lingering after the MCP client disconnects.

---

## 2. Document Retrieval Strategy

### The "Print View" Trick
Instead of parsing the complex, interactive document page (`/Dokument`), we fetch the **Print View**:
*   **URL Pattern:** `https://beck-online.beck.de/Print/CurrentDoc?vpath=[vpath]&printdialogmode=CurrentDoc&options=WithFootNoteInText&options=WithLinks`
*   **Benefit:** This returns a simplified HTML structure (`<div id="printcontent">`) stripped of navigation sidebars, ads, and dynamic widgets, making parsing significantly more robust.

### Markdown Conversion
We implemented a custom `BeckConverter` using `cheerio` and `turndown`:
*   **Structure:** Maps `<h2 class="paragr">` to Markdown titles (`#`) and `<span class="absnr">` to bold paragraph numbers (`**(1)**`).
*   **Links:** Preserves internal `vpath` links so the LLM can "click" citations.
*   **Footnotes:** Extracting footnotes is supported, though the Print View often inlines them or places them at the end.

### Error Handling (Missing Rights)
Authentication success does not imply content access. We handle granular permissions by:
1.  **Detection:** Scanning the HTML for keywords like "Folgendes Dokument kann nicht angezeigt werden" or "notwendigen Rechte".
2.  **Fallback:** If the resulting Markdown body is empty (only title), we infer an access denial and return a specific error message to the LLM, instructing it that the account lacks rights for that specific document.

---

## 3. Search & Navigation logic

### Search
*   **Endpoint:** `/Search`
*   **Pagination:** We default `page` to 1.
*   **Filtering:** The `only_available` parameter appends `&MEINBECKONLINE=True` to the URL to filter results to subscribed modules.
*   **Direct Redirects:** If a search query is a precise citation (e.g., "15 UrhG"), Beck Online redirects immediately to the document. The MCP server detects this (`/Dokument?` in URL) and returns a single "Direct Hit" result instead of crashing on a missing hitlist.

### Legislation Lookup
*   **Flow:** Uses the `/Bcid` endpoint (`/Bcid?y=100&g=BGB&p=1`) which redirects to the correct `vpath`. The server follows this redirect, extracts the `vpath`, and then fetches the Print View.

---

## 4. Security & Configuration

*   **Credentials:** Username and Password are strictly read from environment variables (`BECK_USERNAME`, `BECK_PASSWORD`).
*   **CSRF:** Puppeteer automatically parses and submits the `__RequestVerificationToken` from hidden form fields during login.
*   **TDM Policy:** The server identifies as a standard browser user agent, respecting the `Tdm-Reservation: 1` header by acting as a single-user agent rather than a high-volume scraper.
