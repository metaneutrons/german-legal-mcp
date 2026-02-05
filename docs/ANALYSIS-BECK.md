# Beck Online Traffic Analysis

**Date:** 2026-02-04
**Capture Location:** `/Users/fabian/Desktop/beck-online.beck.de_02-04-2026-22-36-10`
**Objective:** Technical reverse-engineering of the Beck Online web application.

---

## 1. Core API Endpoints & Logic

### Search API
*   **Endpoint:** `GET https://beck-online.beck.de/Search`
*   **Parameters:**
    *   `pagenr`: Page number (e.g., `1`)
    *   `words`: Search terms (e.g., `15+urhg`)
    *   `st`: Search type (optional).
*   **Behavior:**
    *   **Direct Hit:** Redirects (302) to `/Dokument` if the query matches a specific norm/citation.
    *   **Hitlist:** Returns HTML with results in `.treffer-wrapper` elements.
*   **Pagination:**
    *   The backend uses a complex, Gzipped, Base64-encoded Lucene query state stored in the `QUERY` URL parameter (e.g., `H4sIA...`).
    *   Pagination links must be parsed from the HTML `<ul class="paging">` rather than constructed manually.
*   **Filtering:** The parameter `&MEINBECKONLINE=True` restricts results to the user's subscribed modules.

### Document Retrieval
*   **Endpoint:** `GET https://beck-online.beck.de/Dokument`
*   **Identifier:** `vpath` (Virtual Path) is the unique ID for all content (e.g., `bibdata/ges/urhg/cont/urhg.p15.htm`).
*   **Print View (Discovery):**
    *   A cleaner HTML version exists at `/Print/CurrentDoc`.
    *   **URL:** `https://beck-online.beck.de/Print/CurrentDoc?vpath=[vpath]&printdialogmode=CurrentDoc&options=WithFootNoteInText&options=WithLinks`
    *   **Content:** Stripped of sidebars, containing semantic `<h2 class="paragr">`, `<span class="absnr">`, and `<span class="satz">`.

### Legislation Lookup (Bcid)
*   **Endpoint:** `GET https://beck-online.beck.de/Bcid`
*   **Parameters:**
    *   `typ=reference`
    *   `y=[Year/Domain]` (e.g., `100` for Federal Law)
    *   `g=[Law Abbreviation]` (e.g., `BGB`)
    *   `p=[Paragraph]`
*   **Behavior:** 302 Redirect to the canonical `/Dokument` URL.

### Suggestion API
*   **Endpoint:** `GET https://beck-online.beck.de/Suggest/`
*   **Parameters:** `typ=std`, `term=[query]`
*   **Response:** JSON structure (sometimes wrapped in HTML body) containing labels and search IDs.

### Citation API (DAZitierung)
*   **Endpoint:** `GET https://beck-online.beck.de/DAZitierung/Zitierung`
*   **Parameters:** `vpath`, `pubId`, etc.
*   **Response:** JSON with the official citation string (e.g., "BeckOK UrhR § 15 Rn. 1").

---

## 2. Authentication Architecture (OIDC)

The system uses **OpenID Connect** with `account.beck.de` as the Identity Provider.

1.  **Trigger:** Accessing a protected resource redirects to `https://account.beck.de/connect/authorize...`.
2.  **Login Page:** `GET https://account.beck.de/Login` provides a CSRF token (`__RequestVerificationToken`).
3.  **Submission:** `POST https://account.beck.de/Login` with username, password, and token.
4.  **Redirect Chain:**
    *   302 -> `account.beck.de/connect/authorize/callback`
    *   302 -> `beck-online.beck.de/oauth/signin-oidc`
    *   302 -> Protected Resource.
5.  **Critical Cookies:**
    *   `.AspNetCore.OpenIdConnect.Nonce` & `.AspNetCore.Correlation`: Must match the state in the URL during the redirect chain.
    *   **`beck-online.auth`**: The final encrypted session cookie required for API access.

---

## 3. Bot Detection (Fingerprinting)

*   **Endpoint:** `POST https://beck-online.beck.de/Fingerprint/Report`
*   **SDK:** Custom implementation based on **FingerprintJS v5.0.1**.
*   **Checks:**
    *   Canvas rendering (geometry/text hashes).
    *   WebGL vendor/renderer.
    *   Audio context signature.
    *   Navigator properties (hardware concurrency, memory).
    *   Window dimensions vs. screen resolution.
*   **Impact:** Simple HTTP clients (curl, axios) are easily flagged; browser automation is required to generate valid fingerprints.

---

## 4. Security Headers & Policies

*   **CSRF:** All POST requests require `__RequestVerificationToken` and a valid `Referer` matching the previous step in the flow.
*   **TDM Policy:** `Tdm-Reservation: 1` header signals a reservation against Text and Data Mining.
*   **CSP:** Strict Content Security Policy on the main site, though less restrictive on the Print View.