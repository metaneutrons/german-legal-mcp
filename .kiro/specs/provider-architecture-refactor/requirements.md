# Requirements Document

## Introduction

This document specifies the requirements for refactoring the German Legal MCP Server from a monolithic architecture to a provider-based architecture. The refactor enables modular support for multiple legal data sources (Beck Online, RIS, future providers) while maintaining clean separation of concerns. Each provider will be self-contained with its own HTTP client/browser automation, HTML-to-Markdown converter, and tool definitions.

## Glossary

- **Provider**: A self-contained module that implements access to a specific legal data source (e.g., Beck Online, RIS)
- **Provider_Interface**: The contract that all providers must implement to integrate with the MCP server
- **Tool_Definition**: A schema describing an MCP tool's name, description, and input parameters
- **Tool_Handler**: A function that executes the logic for a specific MCP tool
- **MCP_Server**: The Model Context Protocol server that orchestrates providers and handles client requests
- **Orchestrator**: The thin index.ts module that registers providers and routes tool calls
- **Browser_Client**: Puppeteer-based automation for providers requiring JavaScript execution (Beck)
- **HTTP_Client**: Axios-based client for providers with simple REST APIs (RIS)

## Requirements

### Requirement 1: Provider Interface Definition

**User Story:** As a developer, I want a standardized Provider interface, so that all legal data source integrations follow a consistent contract.

#### Acceptance Criteria

1. THE Provider_Interface SHALL define a `name` property that returns the provider's unique identifier string
2. THE Provider_Interface SHALL define a `getTools()` method that returns an array of Tool_Definitions
3. THE Provider_Interface SHALL define a `handleToolCall(toolName, args)` method that executes tool logic and returns a result
4. THE Provider_Interface SHALL define an optional `initialize()` method for provider startup logic
5. THE Provider_Interface SHALL define a `shutdown()` method for cleanup operations
6. WHEN a provider is registered, THE Orchestrator SHALL call `initialize()` if defined
7. WHEN the server shuts down, THE Orchestrator SHALL call `shutdown()` on all registered providers

### Requirement 2: Shared Types Module

**User Story:** As a developer, I want common types defined in a shared module, so that providers and the orchestrator use consistent type definitions.

#### Acceptance Criteria

1. THE shared types module SHALL export a `ToolDefinition` type containing name, description, and inputSchema
2. THE shared types module SHALL export a `ToolResult` type containing content array and optional isError flag
3. THE shared types module SHALL export the `Provider` interface
4. THE shared types module SHALL be located at `src/shared/types.ts`
5. WHEN providers import types, THE imports SHALL reference the shared module path

### Requirement 3: Beck Provider Module

**User Story:** As a developer, I want Beck Online functionality encapsulated in a provider module, so that it is self-contained and maintainable.

#### Acceptance Criteria

1. THE Beck provider SHALL be located in `src/providers/beck/` directory
2. THE Beck provider SHALL implement the Provider_Interface
3. THE Beck provider SHALL contain a `browser.ts` module with Puppeteer automation logic
4. THE Beck provider SHALL contain a `converter.ts` module with HTML-to-Markdown conversion logic
5. THE Beck provider SHALL contain a `tools.ts` module with tool definitions and handlers
6. THE Beck provider SHALL contain an `index.ts` module that exports the provider instance
7. WHEN Beck credentials are not configured, THE Beck provider SHALL return an empty tools array from `getTools()`
8. THE Beck provider SHALL preserve all existing tool functionality (search, get_document, get_legislation, resolve_citation, get_context, get_suggestions, get_referenced_documents)

### Requirement 4: Thin Orchestrator

**User Story:** As a developer, I want index.ts to be a thin orchestrator, so that provider logic is decoupled from server setup.

#### Acceptance Criteria

1. THE Orchestrator SHALL import and register providers from the providers directory
2. THE Orchestrator SHALL aggregate tool definitions from all registered providers
3. WHEN a tool call is received, THE Orchestrator SHALL route it to the correct provider based on tool name prefix
4. THE Orchestrator SHALL handle graceful shutdown by calling shutdown on all providers
5. THE Orchestrator SHALL NOT contain provider-specific business logic
6. THE Orchestrator SHALL set up the MCP server transport and connection

### Requirement 5: Tool Namespacing

**User Story:** As a developer, I want tools namespaced by provider, so that tool names clearly indicate their source.

#### Acceptance Criteria

1. THE Beck provider tools SHALL be prefixed with `beck:` (e.g., `beck:search`, `beck:get_document`)
2. WHEN routing tool calls, THE Orchestrator SHALL extract the provider prefix from the tool name
3. IF a tool name has no recognized prefix, THEN THE Orchestrator SHALL return an error indicating unknown tool

### Requirement 6: Provider Registration

**User Story:** As a developer, I want a simple provider registration mechanism, so that adding new providers requires minimal orchestrator changes.

#### Acceptance Criteria

1. THE Orchestrator SHALL maintain an array of registered Provider instances
2. WHEN listing tools, THE Orchestrator SHALL concatenate tools from all registered providers
3. THE Orchestrator SHALL support registering multiple providers
4. WHEN a provider's `getTools()` returns empty array, THE Orchestrator SHALL exclude that provider's tools from the listing

### Requirement 7: RIS Provider Placeholder

**User Story:** As a developer, I want a placeholder RIS provider module, so that the architecture supports future RIS integration.

#### Acceptance Criteria

1. THE RIS provider placeholder SHALL be located in `src/providers/ris/` directory
2. THE RIS provider placeholder SHALL implement the Provider_Interface
3. THE RIS provider placeholder SHALL return an empty tools array from `getTools()`
4. THE RIS provider placeholder SHALL have a no-op `shutdown()` method

### Requirement 8: Existing Functionality Preservation

**User Story:** As a user, I want all existing Beck Online functionality to work after the refactor, so that the refactor does not break current capabilities.

#### Acceptance Criteria

1. WHEN searching Beck Online, THE Beck provider SHALL return search results in the same format as before
2. WHEN fetching documents, THE Beck provider SHALL return Markdown content in the same format as before
3. WHEN resolving citations, THE Beck provider SHALL return vpath and canonical URL as before
4. WHEN credentials are missing, THE Beck provider tools SHALL be hidden from tool listing
5. WHEN access is denied to a document, THE Beck provider SHALL return an error with isError flag
6. THE Beck provider SHALL preserve session persistence to `~/.beck-online-mcp/cookies.json`

### Requirement 9: Shared Utilities Module

**User Story:** As a developer, I want shared utilities in a common module, so that providers can reuse common functionality.

#### Acceptance Criteria

1. THE shared utilities module SHALL be located at `src/shared/utils.ts`
2. THE shared utilities module SHALL export utility functions that may be shared across providers
3. IF no shared utilities are needed initially, THEN THE module SHALL export an empty object or placeholder

### Requirement 10: Error Handling Consistency

**User Story:** As a developer, I want consistent error handling across providers, so that errors are reported uniformly to MCP clients.

#### Acceptance Criteria

1. WHEN a provider tool encounters an error, THE tool handler SHALL return a ToolResult with `isError: true`
2. WHEN a provider tool encounters an error, THE error message SHALL be included in the content array
3. THE ToolResult type SHALL enforce the error response structure
