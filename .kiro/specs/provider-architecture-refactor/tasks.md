# Implementation Plan: Provider Architecture Refactor

## Overview

This plan refactors the German Legal MCP Server from a monolithic architecture to a provider-based architecture. Tasks are ordered to build incrementally: shared types first, then Beck provider migration, then orchestrator refactor, and finally RIS placeholder.

## Tasks

- [ ] 1. Create shared types module
  - [x] 1.1 Create `src/shared/types.ts` with Provider interface, ToolDefinition, and ToolResult types
    - Define `ToolDefinition` interface with name, description, inputSchema (Zod)
    - Define `ToolResult` interface with content array and optional isError
    - Define `Provider` interface with name, getTools(), handleToolCall(), initialize?(), shutdown()
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4_
  - [x] 1.2 Create `src/shared/utils.ts` placeholder module
    - Export empty object or placeholder comment for future utilities
    - _Requirements: 9.1, 9.3_

- [x] 2. Migrate Beck browser module
  - [x] 2.1 Create `src/providers/beck/browser.ts` by moving BeckBrowser class
    - Copy `src/beck_browser.ts` to `src/providers/beck/browser.ts`
    - Update import paths if needed
    - Preserve singleton pattern, session persistence, OIDC flow
    - _Requirements: 3.3, 8.6_

- [x] 3. Migrate Beck converter module
  - [x] 3.1 Create `src/providers/beck/converter.ts` by moving BeckConverter class
    - Copy `src/converter.ts` to `src/providers/beck/converter.ts`
    - Update import paths if needed
    - Preserve all Turndown rules and access denial detection
    - _Requirements: 3.4_
  - [x] 3.2 Move `src/converter.test.ts` to `src/providers/beck/converter.test.ts`
    - Update import paths to reference new converter location
    - Verify all existing tests pass
    - _Requirements: 3.4_

- [x] 4. Create Beck tools module
  - [x] 4.1 Create `src/providers/beck/tools.ts` with tool definitions and handlers
    - Extract tool definitions from index.ts into `beckToolDefinitions` array
    - Create `handleBeckToolCall()` function with switch statement for each tool
    - Implement handlers: search, get_document, get_legislation, resolve_citation, get_context, get_suggestions, get_referenced_documents
    - Import BeckBrowser and BeckConverter as dependencies
    - _Requirements: 3.5, 3.8, 8.1, 8.2, 8.3, 8.5_
  - [x] 4.2 Write property test for Beck tool naming convention
    - **Property 7: Beck Tool Naming Convention**
    - Verify all tools from beckToolDefinitions start with "beck:"
    - **Validates: Requirements 5.1**

- [x] 5. Create Beck provider entry point
  - [x] 5.1 Create `src/providers/beck/index.ts` with BeckProvider class
    - Implement Provider interface
    - Add `isConfigured()` check for BECK_USERNAME and BECK_PASSWORD
    - Return empty array from getTools() when not configured
    - Delegate handleToolCall() to tools.ts handler
    - Implement shutdown() to close browser
    - Export singleton `beckProvider` instance
    - _Requirements: 3.2, 3.6, 3.7, 8.4_
  - [x] 5.2 Write property test for credential-based tool visibility
    - **Property 10: Credential-Based Tool Visibility**
    - Test that without credentials, getTools() returns []
    - **Validates: Requirements 3.7, 8.4**

- [x] 6. Create RIS provider placeholder
  - [x] 6.1 Create `src/providers/ris/index.ts` with RisProvider placeholder
    - Implement Provider interface with name = 'ris'
    - Return empty array from getTools()
    - Return error from handleToolCall() indicating not implemented
    - Implement no-op shutdown()
    - Export singleton `risProvider` instance
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 7. Checkpoint - Verify provider modules
  - Ensure all provider modules compile without errors
  - Run existing converter tests to verify migration
  - Ask the user if questions arise

- [x] 8. Refactor orchestrator (index.ts)
  - [x] 8.1 Rewrite `src/index.ts` as thin orchestrator
    - Remove all Beck-specific code (tool definitions, handlers)
    - Import beckProvider and risProvider
    - Create providers Map and register providers
    - Implement ListToolsRequestSchema handler to aggregate tools from all providers
    - Implement CallToolRequestSchema handler to route by prefix
    - Preserve graceful shutdown (SIGINT, SIGTERM, stdin close)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4_
  - [x] 8.2 Write property test for tool aggregation
    - **Property 4: Tool Aggregation**
    - Test that getAllTools returns union of all provider tools
    - **Validates: Requirements 4.2, 6.2**
  - [x] 8.3 Write property test for tool routing by prefix
    - **Property 5: Tool Routing by Prefix**
    - Test that tool calls are routed to correct provider
    - **Validates: Requirements 4.3, 5.2**
  - [x] 8.4 Write property test for unknown prefix error handling
    - **Property 6: Unknown Prefix Error Handling**
    - Test that unknown prefixes return isError: true
    - **Validates: Requirements 5.3**

- [x] 9. Checkpoint - Verify orchestrator integration
  - Build project with `npm run build`
  - Run all tests with `npm test`
  - Ensure all tests pass
  - Ask the user if questions arise

- [x] 10. Write orchestrator lifecycle tests
  - [x] 10.1 Write property test for shutdown lifecycle
    - **Property 3: Orchestrator Shutdown Lifecycle**
    - Test that shutdown calls shutdown() on all providers
    - **Validates: Requirements 1.7, 4.4**
  - [x] 10.2 Write property test for Provider interface conformance
    - **Property 1: Provider Interface Conformance**
    - Test that BeckProvider and RisProvider have all required members
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 3.2, 7.2**
  - [x] 10.3 Write property test for error response structure
    - **Property 11: Error Response Structure**
    - Test that errors have isError: true and message in content
    - **Validates: Requirements 10.1, 10.2**

- [x] 11. Cleanup old files
  - [x] 11.1 Delete old monolithic files
    - Delete `src/beck_browser.ts` (moved to providers/beck/)
    - Delete `src/converter.ts` (moved to providers/beck/)
    - Delete `src/converter.test.ts` (moved to providers/beck/)
    - _Requirements: 3.1, 3.3, 3.4_

- [x] 12. Final checkpoint - Full verification
  - Build project with `npm run build`
  - Run all tests with `npm test`
  - Verify no TypeScript compilation errors
  - Ensure all tests pass
  - Ask the user if questions arise

## Notes

- All tasks are required including property tests
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests use fast-check library with minimum 100 iterations
- ESM imports require `.js` extension in import paths
