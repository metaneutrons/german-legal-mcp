# Requirements Document

## Introduction

This document specifies the requirements for refactoring the German Legal MCP Server from a monolithic architecture to a modular, provider-based architecture. The refactoring enables clean separation of data sources (Beck Online, RIS, future providers) into self-contained modules while maintaining backward compatibility with existing functionality.

## Glossary

- **Provider**: A self-contained module that implements access to a specific legal data source (e.g., Beck Online, RIS)
- **MCP_Server**: The Model Context Protocol server that orchestrates tool registration and request handling
- **Tool**: An MCP-exposed function that clients can invoke (e.g., `beck:search`, `beck:get_document`)
- **Tool_Definition**: The schema and metadata describing a tool's name, description, and input parameters
- **Tool_Handler**: The function that executes when a tool is invoked
- **Orchestrator**: The thin `index.ts` module that aggregates and registers tools from all providers
- **vpath**: Beck Online's unique document identifier path

## Requirements

### Requirement 1: Provider Interface Definition

**User Story:** As a developer, I want a standardized Provider interface, so that all data sources implement a consistent contract for tool registration and lifecycle management.

#### Acceptance Criteria

1. THE Provider interface SHALL define a `name` property containing the provider's unique identifier string
2. THE Provider interface SHALL define a `getToolDefinitions()` method that returns an array of tool definitions
3. THE Provider interface SHALL define a `handleToolCall(name, args)` method that executes tool requests and returns results
4. THE Provider interface SHALL define an `isConfigured()` method that returns a boolean indicating if the provider has required configuration
5. THE Provider interface SHALL define a `cleanup()` method for releasing resources during shutdown
6. WHEN a provider is not configured, THEN the `getToolDefinitions()` method SHALL return an empty array

### Requirement 2: Beck Provider Module

**User Story:** As a developer, I want the existing Beck Online functionality encapsulated in a provider module, so that it follows the new architecture without changing external behavior.

#### Acceptance Criteria

1. THE Beck_Provider SHALL implement the Provider interface
2. THE Beck_Provider SHALL expose all seven existing tools: `beck:search`, `beck:get_document`, `beck:get_legislation`, `beck:resolve_citation`, `beck:get_context`, `beck:get_suggestions`, `beck:get_referenced_documents`
3. WHEN a Beck tool is invoked, THEN the Beck_Provider SHALL produce identical output to the current implementation
4. THE Beck_Provider SHALL use the existing BeckBrowser singleton for browser automation
5. THE Beck_Provider SHALL use the existing BeckConverter for HTML-to-Markdown conversion
6. WHEN `isConfigured()` is called, THEN the Beck_Provider SHALL return true only if both `BECK_USERNAME` and `BECK_PASSWORD` environment variables are set and non-empty

### Requirement 3: Thin Orchestrator

**User Story:** As a developer, I want a thin orchestrator in `index.ts`, so that it only handles MCP server setup and delegates all tool logic to providers.

#### Acceptance Criteria

1. THE Orchestrator SHALL import and instantiate all available providers
2. WHEN the MCP server receives a `ListTools` request, THEN the Orchestrator SHALL aggregate tool definitions from all configured providers
3. WHEN the MCP server receives a `CallTool` request, THEN the Orchestrator SHALL route the request to the appropriate provider based on tool name prefix
4. THE Orchestrator SHALL handle graceful shutdown by calling `cleanup()` on all providers
5. THE Orchestrator SHALL NOT contain any tool-specific business logic
6. IF a tool call targets an unconfigured provider, THEN the Orchestrator SHALL return an error response with `isError: true`

### Requirement 4: Shared Types Module

**User Story:** As a developer, I want shared type definitions, so that providers and the orchestrator use consistent interfaces.

#### Acceptance Criteria

1. THE shared types module SHALL define a `ToolResult` interface with `content` array and optional `isError` boolean
2. THE shared types module SHALL define a `ToolDefinition` interface matching MCP SDK requirements
3. THE shared types module SHALL export the Provider interface for provider implementations
4. WHEN a provider returns a result, THEN it SHALL conform to the `ToolResult` interface

### Requirement 5: File Structure Organization

**User Story:** As a developer, I want a clear directory structure, so that code is organized by responsibility and easy to navigate.

#### Acceptance Criteria

1. THE `src/providers/` directory SHALL contain provider implementations
2. THE `src/providers/types.ts` file SHALL contain the Provider interface and common provider types
3. THE `src/providers/beck/` directory SHALL contain all Beck-specific code
4. THE `src/providers/beck/index.ts` file SHALL export the Beck provider instance
5. THE `src/shared/` directory SHALL contain shared utilities and types
6. THE `src/shared/types.ts` file SHALL contain ToolResult and other shared interfaces
7. WHEN a new provider is added, THEN it SHALL be placed in `src/providers/{provider-name}/`

### Requirement 6: Backward Compatibility

**User Story:** As a user, I want all existing Beck tools to work identically after refactoring, so that my workflows are not disrupted.

#### Acceptance Criteria

1. WHEN `beck:search` is called with identical parameters, THEN the response SHALL be identical to the pre-refactor implementation
2. WHEN `beck:get_document` is called with identical parameters, THEN the response SHALL be identical to the pre-refactor implementation
3. WHEN `beck:get_legislation` is called with identical parameters, THEN the response SHALL be identical to the pre-refactor implementation
4. WHEN `beck:resolve_citation` is called with identical parameters, THEN the response SHALL be identical to the pre-refactor implementation
5. WHEN `beck:get_context` is called with identical parameters, THEN the response SHALL be identical to the pre-refactor implementation
6. WHEN `beck:get_suggestions` is called with identical parameters, THEN the response SHALL be identical to the pre-refactor implementation
7. WHEN `beck:get_referenced_documents` is called with identical parameters, THEN the response SHALL be identical to the pre-refactor implementation
8. THE existing unit tests SHALL pass without modification
9. THE existing integration tests SHALL pass without modification

### Requirement 7: Provider Discovery and Registration

**User Story:** As a developer, I want providers to be easily discoverable and registerable, so that adding new providers requires minimal orchestrator changes.

#### Acceptance Criteria

1. THE Orchestrator SHALL maintain a registry of available providers
2. WHEN the server starts, THEN the Orchestrator SHALL check each provider's `isConfigured()` status
3. WHEN listing tools, THEN the Orchestrator SHALL only include tools from configured providers
4. THE provider registration mechanism SHALL support adding new providers with a single import statement
5. IF a provider throws during initialization, THEN the Orchestrator SHALL log the error and continue with other providers

### Requirement 8: Error Handling Consistency

**User Story:** As a developer, I want consistent error handling across providers, so that clients receive predictable error responses.

#### Acceptance Criteria

1. WHEN a tool handler throws an exception, THEN the provider SHALL return a ToolResult with `isError: true` and error message in content
2. WHEN a provider is not configured and a tool is called, THEN the response SHALL include a descriptive error message
3. WHEN access is denied to a Beck document, THEN the error response format SHALL remain unchanged
4. THE error message format SHALL be consistent across all providers
