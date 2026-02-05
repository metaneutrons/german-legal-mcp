# Product Overview

German Legal MCP Server - A Model Context Protocol server for German legal research.

## Purpose
Enables LLM applications to search and retrieve legal documents from multiple German legal databases:

### Beck Online (implemented)
- Laws and legislation (Gesetze)
- Court decisions (Rechtsprechung)
- Legal commentaries (Kommentare)
- Academic articles (Aufsätze)

### Gesetze im Internet (planned)
- All federal German laws
- Free public access, no authentication

### Rechtsprechung im Internet (planned)
- Federal court decisions
- Free public access, no authentication

## Key Features
- Unified interface for multiple legal sources
- Semantic search across databases
- Full-text document retrieval converted to clean Markdown
- Direct legislation lookup by citation
- Tool namespacing by source (`beck:`, `gii:`, `rii:`)

## Target Users
Legal professionals and LLM applications requiring access to German legal resources through the MCP protocol.

## Domain Context
- German legal system terminology and conventions
- Beck Online requires subscription authentication
- Gesetze/Rechtsprechung im Internet are free public resources
- Documents use German legal citation formats and structure
