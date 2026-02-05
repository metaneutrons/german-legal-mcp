# Project Structure

```
beck-online-mcp/
├── src/                    # TypeScript source files
│   ├── index.ts           # MCP server entry point, tool definitions & handlers
│   ├── beck_browser.ts    # Puppeteer browser automation (singleton)
│   ├── converter.ts       # HTML to Markdown conversion
│   ├── converter.test.ts  # Unit tests for converter
│   ├── auth/              # (empty - reserved for auth modules)
│   ├── tools/             # (empty - reserved for tool modules)
│   └── utils/             # (empty - reserved for utilities)
├── tests/                  # Integration tests
│   ├── fixtures/          # HTML test fixtures
│   ├── credentials.test.ts
│   └── converter.integration.test.ts
├── dist/                   # Compiled JavaScript output
├── .kiro/                  # Kiro configuration
│   └── steering/          # AI assistant guidance
├── vitest.config.ts       # Test configuration
├── ANALYSIS.md            # Technical reverse-engineering notes
├── IMPLEMENTATION_NOTES.md # Architecture decisions documentation
├── package.json
└── tsconfig.json
```

## Key Modules

### `index.ts` - Server Entry Point
- Defines MCP tools using Zod schemas
- Implements tool request handlers
- Manages server lifecycle and graceful shutdown
- Tools: `beck:search`, `beck:get_document`, `beck:get_legislation`, `beck:resolve_citation`, `beck:get_context`, `beck:get_suggestions`, `beck:get_referenced_documents`

### `beck_browser.ts` - Browser Automation
- Singleton pattern for browser instance reuse
- Handles OIDC authentication flow with Beck Online
- Session persistence (cookies saved to disk)
- Methods: `fetchPage()`, `resolveUrl()`, `login()`, `close()`

### `converter.ts` - Document Processing
- `BeckConverter` class for HTML → Markdown transformation
- Custom Turndown rules for legal document structure
- Access denial detection
- Context extraction (breadcrumbs, navigation)

## Architecture Patterns
- Singleton browser instance for performance
- Print View fetching for cleaner HTML parsing
- Graceful shutdown handling (SIGINT, SIGTERM, stdin close)
- Error responses use `isError: true` flag in MCP response
