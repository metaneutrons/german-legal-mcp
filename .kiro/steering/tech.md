# Tech Stack

## Runtime & Language
- Node.js with ES Modules (`"type": "module"`)
- TypeScript (ES2022 target, NodeNext module resolution)
- Output compiled to `dist/` directory

## Core Dependencies
- `@modelcontextprotocol/sdk` - MCP server implementation
- `puppeteer` - Headless Chrome for browser automation
- `cheerio` - HTML parsing and manipulation
- `turndown` - HTML to Markdown conversion
- `zod` - Schema validation for tool inputs
- `axios` + `tough-cookie` - HTTP client with cookie support
- `dotenv` - Environment variable management

## Testing
- `vitest` - Test runner (ESM-native, fast)
- `@vitest/coverage-v8` - Code coverage

## Build & Run Commands

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Start the MCP server
npm start

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Configuration
Environment variables required:
- `BECK_USERNAME` - Beck Online account username
- `BECK_PASSWORD` - Beck Online account password

Session cookies are persisted to `~/.beck-online-mcp/cookies.json`

## TypeScript Configuration
- Target: ES2022
- Module: NodeNext
- ESM imports require `.js` extension in import paths
- Strict mode not enabled

## MCP Client Integration
Add to MCP client config (e.g., `claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "beck-online": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "BECK_USERNAME": "...",
        "BECK_PASSWORD": "..."
      }
    }
  }
}
```
