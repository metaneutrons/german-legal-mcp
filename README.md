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
| [Beck Online](https://beck-online.beck.de) | ✅ Available | `beck:` | Required (subscription) |
| [Rechtsinformationen Bund](http://testphase.rechtsinformationen.bund.de) | 🚧 Planned | `ris:` | None (public) |
| [Gesetze im Internet](https://www.gesetze-im-internet.de) | 🚧 Planned | `gii:` | None (public) |
| [Rechtsprechung im Internet](https://www.rechtsprechung-im-internet.de) | 🚧 Planned | `rii:` | None (public) |

## Features

### Beck Online (`beck:*` tools)
- Search laws, cases, and commentaries
- Full-text document retrieval as Markdown
- Direct legislation lookup (e.g., "BGB § 823")
- Citation resolution and autocomplete
- Document context and navigation

### Rechtsinformationen Bund (planned)
- Unified access to federal legal information
- Laws, court decisions, and administrative regulations
- Free, no authentication required

### Gesetze im Internet (planned)
- Access to all federal German laws
- Free, no authentication required

### Rechtsprechung im Internet (planned)
- Federal court decisions
- Free, no authentication required

## Installation

### Prerequisites
- Node.js >= 22.0.0 (LTS)
- npm or yarn

### Setup

```bash
# Clone the repository
git clone https://github.com/metaneutrons/german-legal-mcp.git
cd german-legal-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

### Quick Start with npx

You can run the server directly without cloning:

```bash
npx german-legal-mcp
```

Set environment variables for Beck Online access:

```bash
BECK_USERNAME=your_username BECK_PASSWORD=your_password npx german-legal-mcp
```

## Configuration

Add to your MCP client config (e.g., `claude_desktop_config.json`):

### Using npx (recommended)

```json
{
  "mcpServers": {
    "german-legal": {
      "command": "npx",
      "args": ["-y", "german-legal-mcp"],
      "env": {
        "BECK_USERNAME": "YourUsername",
        "BECK_PASSWORD": "YourPassword"
      }
    }
  }
}
```

### Using local installation

```json
{
  "mcpServers": {
    "german-legal": {
      "command": "node",
      "args": ["/path/to/german-legal-mcp/dist/index.js"],
      "env": {
        "BECK_USERNAME": "YourUsername",
        "BECK_PASSWORD": "YourPassword"
      }
    }
  }
}
```

Beck credentials are optional — if not provided, `beck:*` tools are disabled but other sources remain available.

### Alternative: Environment Variables

Instead of config file, you can set environment variables:

```bash
export BECK_USERNAME="YourUsername"
export BECK_PASSWORD="YourPassword"
node /path/to/german-legal-mcp/dist/index.js
```

Or create a `.env` file in the project root:

```env
BECK_USERNAME=YourUsername
BECK_PASSWORD=YourPassword
```

## Tools

### Beck Online
| Tool | Description |
|------|-------------|
| `beck:search` | Search the database |
| `beck:get_document` | Retrieve document content |
| `beck:get_legislation` | Direct law lookup |
| `beck:resolve_citation` | Resolve citation to document |
| `beck:get_context` | Get navigation context |
| `beck:get_referenced_documents` | List cited documents |
| `beck:get_suggestions` | Autocomplete suggestions |

## Usage

Once configured, the MCP server provides tools that can be used by any MCP client (like Claude Desktop). The tools are automatically available in the client interface.

### Example Tool Calls

**Search for legal documents:**
```json
{
  "tool": "beck:search",
  "arguments": {
    "query": "Schadensersatz § 823 BGB"
  }
}
```

**Get specific legislation:**
```json
{
  "tool": "beck:get_legislation",
  "arguments": {
    "citation": "BGB § 823"
  }
}
```

**Retrieve document content:**
```json
{
  "tool": "beck:get_document",
  "arguments": {
    "url": "https://beck-online.beck.de/Dokument?vpath=..."
  }
}
```

## Development

```bash
npm test              # Run tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

### Commit Convention

This repo uses [Conventional Commits](https://www.conventionalcommits.org/). Commits are validated via Husky + commitlint.

```
<type>(<scope>): <description>

# Examples:
feat(beck): add document caching
fix(core): handle empty responses
docs: update README
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`

**Scopes:** `beck`, `gii`, `rii`, `core`, `deps`, `config`

## Architecture

- **Puppeteer** for browser automation (handles OIDC auth, fingerprinting)
- **Cheerio + Turndown** for HTML → Markdown conversion
- **Zod** for input validation
- Tools are namespaced by source (`beck:`, `gii:`, `rii:`) for clarity

## License

GPL-3.0 - See [LICENSE](LICENSE) for details.
