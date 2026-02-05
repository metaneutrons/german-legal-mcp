# Design Document: Provider Architecture Refactor

## Overview

This design describes the refactoring of the German Legal MCP Server from a monolithic architecture to a modular provider-based architecture. The refactor introduces a `Provider` interface that all legal data source integrations must implement, enabling clean separation of concerns and easy addition of new providers.

The architecture follows these principles:
- **Single Responsibility**: Each provider owns its HTTP client, converter, and tool handlers
- **Dependency Inversion**: The orchestrator depends on the Provider interface, not concrete implementations
- **Open/Closed**: New providers can be added without modifying the orchestrator

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         MCP Client                               │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    index.ts (Orchestrator)                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ - Registers providers                                        ││
│  │ - Aggregates tool definitions                                ││
│  │ - Routes tool calls by prefix                                ││
│  │ - Manages graceful shutdown                                  ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            ▼                   ▼                   ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│   Beck Provider   │ │   RIS Provider    │ │  Future Provider  │
│                   │ │   (placeholder)   │ │                   │
│ ┌───────────────┐ │ │                   │ │                   │
│ │  browser.ts   │ │ │                   │ │                   │
│ │  (Puppeteer)  │ │ │                   │ │                   │
│ └───────────────┘ │ │                   │ │                   │
│ ┌───────────────┐ │ │                   │ │                   │
│ │ converter.ts  │ │ │                   │ │                   │
│ │ (HTML→MD)     │ │ │                   │ │                   │
│ └───────────────┘ │ │                   │ │                   │
│ ┌───────────────┐ │ │                   │ │                   │
│ │   tools.ts    │ │ │                   │ │                   │
│ │ (definitions) │ │ │                   │ │                   │
│ └───────────────┘ │ │                   │ │                   │
└───────────────────┘ └───────────────────┘ └───────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      shared/types.ts                             │
│  Provider, ToolDefinition, ToolResult                            │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Provider Interface

The core abstraction that all legal data source integrations must implement:

```typescript
// src/shared/types.ts

import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export interface Provider {
  /** Unique provider identifier (e.g., 'beck', 'ris') */
  readonly name: string;
  
  /** Returns tool definitions for this provider. Empty array if not configured. */
  getTools(): ToolDefinition[];
  
  /** Handles a tool call. toolName includes the provider prefix. */
  handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
  
  /** Optional initialization logic called during registration */
  initialize?(): Promise<void>;
  
  /** Cleanup logic called during shutdown */
  shutdown(): Promise<void>;
}
```

### Orchestrator (index.ts)

The thin orchestrator manages provider lifecycle and routes requests:

```typescript
// src/index.ts (pseudocode structure)

class Orchestrator {
  private providers: Map<string, Provider> = new Map();
  
  registerProvider(provider: Provider): void {
    this.providers.set(provider.name, provider);
  }
  
  getAllTools(): ToolDefinition[] {
    return Array.from(this.providers.values())
      .flatMap(p => p.getTools());
  }
  
  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const [prefix] = toolName.split(':');
    const provider = this.providers.get(prefix);
    if (!provider) {
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
    }
    return provider.handleToolCall(toolName, args);
  }
  
  async shutdown(): Promise<void> {
    for (const provider of this.providers.values()) {
      await provider.shutdown();
    }
  }
}
```

### Beck Provider Structure

```
src/providers/beck/
├── index.ts      # Exports BeckProvider instance
├── browser.ts    # BeckBrowser class (Puppeteer singleton)
├── converter.ts  # BeckConverter class (HTML → Markdown)
└── tools.ts      # Tool definitions and handler implementations
```

#### browser.ts

Moves the existing `BeckBrowser` class with:
- Singleton pattern for browser instance reuse
- OIDC authentication flow
- Session persistence to `~/.beck-online-mcp/cookies.json`
- `fetchPage()`, `resolveUrl()`, `login()`, `close()` methods

#### converter.ts

Moves the existing `BeckConverter` class with:
- Turndown-based HTML to Markdown conversion
- Custom rules for legal document structure (absnr, satz, aufz)
- Access denial detection
- Context extraction (breadcrumbs, navigation)

#### tools.ts

Contains tool definitions and handler logic:

```typescript
// src/providers/beck/tools.ts (structure)

import { z } from 'zod';
import { ToolDefinition, ToolResult } from '../../shared/types.js';
import { BeckBrowser } from './browser.js';
import { BeckConverter } from './converter.js';

export const beckToolDefinitions: ToolDefinition[] = [
  {
    name: 'beck:search',
    description: 'Search the Beck Online legal database...',
    inputSchema: z.object({
      query: z.string(),
      page: z.number().optional().default(1),
      only_available: z.boolean().optional().default(false),
      category: z.enum([...]).optional(),
    }),
  },
  // ... other tool definitions
];

export async function handleBeckToolCall(
  toolName: string,
  args: Record<string, unknown>,
  browser: BeckBrowser,
  converter: BeckConverter
): Promise<ToolResult> {
  switch (toolName) {
    case 'beck:search':
      return handleSearch(args, browser);
    case 'beck:get_document':
      return handleGetDocument(args, browser, converter);
    // ... other handlers
    default:
      return { content: [{ type: 'text', text: `Unknown Beck tool: ${toolName}` }], isError: true };
  }
}
```

#### index.ts (Beck Provider Entry)

```typescript
// src/providers/beck/index.ts

import { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';
import { BeckBrowser } from './browser.js';
import { BeckConverter } from './converter.js';
import { beckToolDefinitions, handleBeckToolCall } from './tools.js';

export class BeckProvider implements Provider {
  readonly name = 'beck';
  private browser: BeckBrowser;
  private converter: BeckConverter;
  
  constructor() {
    this.browser = BeckBrowser.getInstance();
    this.converter = new BeckConverter();
  }
  
  private isConfigured(): boolean {
    return !!(process.env.BECK_USERNAME && process.env.BECK_PASSWORD);
  }
  
  getTools(): ToolDefinition[] {
    return this.isConfigured() ? beckToolDefinitions : [];
  }
  
  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.isConfigured()) {
      return {
        content: [{ type: 'text', text: 'Beck Online tools are disabled. Set BECK_USERNAME and BECK_PASSWORD.' }],
        isError: true,
      };
    }
    return handleBeckToolCall(toolName, args, this.browser, this.converter);
  }
  
  async shutdown(): Promise<void> {
    await this.browser.close();
  }
}

export const beckProvider = new BeckProvider();
```

### RIS Provider Placeholder

```typescript
// src/providers/ris/index.ts

import { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';

export class RisProvider implements Provider {
  readonly name = 'ris';
  
  getTools(): ToolDefinition[] {
    return []; // Not implemented yet
  }
  
  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    return {
      content: [{ type: 'text', text: `RIS provider not implemented: ${toolName}` }],
      isError: true,
    };
  }
  
  async shutdown(): Promise<void> {
    // No-op
  }
}

export const risProvider = new RisProvider();
```

### Shared Types Module

```typescript
// src/shared/types.ts

import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export interface Provider {
  readonly name: string;
  getTools(): ToolDefinition[];
  handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
  initialize?(): Promise<void>;
  shutdown(): Promise<void>;
}
```

### Shared Utilities Module

```typescript
// src/shared/utils.ts

// Placeholder for shared utilities
// Future utilities might include:
// - Common error formatting
// - URL manipulation helpers
// - Logging utilities

export {};
```

## Data Models

### ToolDefinition

| Field | Type | Description |
|-------|------|-------------|
| name | string | Unique tool identifier with provider prefix (e.g., `beck:search`) |
| description | string | Human-readable description for MCP clients |
| inputSchema | z.ZodType | Zod schema defining input parameters |

### ToolResult

| Field | Type | Description |
|-------|------|-------------|
| content | Array<{type: string, text: string}> | MCP content blocks |
| isError | boolean (optional) | True if the result represents an error |

### Provider

| Field/Method | Type | Description |
|--------------|------|-------------|
| name | string (readonly) | Unique provider identifier |
| getTools() | ToolDefinition[] | Returns available tools (empty if not configured) |
| handleToolCall() | Promise<ToolResult> | Executes tool logic |
| initialize() | Promise<void> (optional) | Startup logic |
| shutdown() | Promise<void> | Cleanup logic |

### Directory Structure

```
src/
├── index.ts                    # Thin MCP server orchestrator
├── providers/
│   ├── beck/
│   │   ├── index.ts           # BeckProvider class export
│   │   ├── browser.ts         # BeckBrowser (Puppeteer singleton)
│   │   ├── converter.ts       # BeckConverter (HTML → Markdown)
│   │   └── tools.ts           # Tool definitions + handlers
│   └── ris/
│       └── index.ts           # RisProvider placeholder
└── shared/
    ├── types.ts               # Provider, ToolDefinition, ToolResult
    └── utils.ts               # Shared utilities (placeholder)
```



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Provider Interface Conformance

*For any* object implementing the Provider interface, it SHALL have a `name` property (string), a `getTools()` method returning an array of ToolDefinitions, a `handleToolCall()` method returning Promise<ToolResult>, and a `shutdown()` method returning Promise<void>.

**Validates: Requirements 1.1, 1.2, 1.3, 1.5, 3.2, 7.2**

### Property 2: Orchestrator Initialization Lifecycle

*For any* provider with an `initialize()` method defined, when that provider is registered with the orchestrator, the orchestrator SHALL call `initialize()` exactly once.

**Validates: Requirements 1.6**

### Property 3: Orchestrator Shutdown Lifecycle

*For any* set of registered providers, when the orchestrator's shutdown is called, it SHALL call `shutdown()` on every registered provider.

**Validates: Requirements 1.7, 4.4**

### Property 4: Tool Aggregation

*For any* set of registered providers, the orchestrator's `getAllTools()` SHALL return an array containing exactly the union of all tools returned by each provider's `getTools()`.

**Validates: Requirements 4.2, 6.2**

### Property 5: Tool Routing by Prefix

*For any* tool call with name in format `{prefix}:{action}`, the orchestrator SHALL route the call to the provider whose `name` equals `{prefix}`.

**Validates: Requirements 4.3, 5.2**

### Property 6: Unknown Prefix Error Handling

*For any* tool call with a prefix that does not match any registered provider's name, the orchestrator SHALL return a ToolResult with `isError: true` and a message indicating the tool is unknown.

**Validates: Requirements 5.3**

### Property 7: Beck Tool Naming Convention

*For any* tool definition returned by the Beck provider's `getTools()`, the tool name SHALL start with the prefix `beck:`.

**Validates: Requirements 5.1**

### Property 8: Empty Provider Exclusion

*For any* provider whose `getTools()` returns an empty array, the orchestrator's aggregated tool list SHALL contain zero tools from that provider.

**Validates: Requirements 6.4**

### Property 9: Multiple Provider Support

*For any* number N of providers (where N >= 2), the orchestrator SHALL successfully register all N providers and route tool calls to the correct provider based on prefix.

**Validates: Requirements 6.3**

### Property 10: Credential-Based Tool Visibility

*For any* state where Beck credentials (BECK_USERNAME, BECK_PASSWORD) are not set, the Beck provider's `getTools()` SHALL return an empty array.

**Validates: Requirements 3.7, 8.4**

### Property 11: Error Response Structure

*For any* provider tool call that encounters an error, the returned ToolResult SHALL have `isError: true` and the `content` array SHALL contain at least one element with the error message.

**Validates: Requirements 10.1, 10.2**

### Property 12: Access Denial Error Handling

*For any* Beck document fetch that encounters an access denial, the Beck provider SHALL return a ToolResult with `isError: true`.

**Validates: Requirements 8.5**

## Error Handling

### Provider-Level Errors

Each provider is responsible for catching and formatting its own errors:

```typescript
async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    // Tool implementation
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
}
```

### Orchestrator-Level Errors

The orchestrator handles routing errors:

| Error Condition | Response |
|-----------------|----------|
| Unknown tool prefix | `{ content: [{ type: 'text', text: 'Unknown tool: {name}' }], isError: true }` |
| Provider not configured | Provider returns empty tools array (tools hidden from listing) |

### Beck Provider Specific Errors

| Error Condition | Response |
|-----------------|----------|
| Credentials not set | Tools hidden; if called directly, returns error message |
| Access denied | `{ content: [{ type: 'text', text: 'ERROR: Access Denied for vpath: {vpath}' }], isError: true }` |
| Empty document content | `{ content: [{ type: 'text', text: 'ERROR: Document content empty...' }], isError: true }` |
| Login failure | Error propagated with authentication details |

## Testing Strategy

### Dual Testing Approach

This refactor requires both unit tests and property-based tests:

- **Unit tests**: Verify specific examples, edge cases, and integration points
- **Property tests**: Verify universal properties across all valid inputs

### Property-Based Testing Configuration

- **Library**: fast-check (TypeScript property-based testing)
- **Minimum iterations**: 100 per property test
- **Tag format**: `Feature: provider-architecture-refactor, Property {N}: {description}`

### Unit Test Coverage

| Component | Test Focus |
|-----------|------------|
| Provider Interface | Type conformance, method signatures |
| Orchestrator | Registration, routing, shutdown lifecycle |
| Beck Provider | Tool definitions, credential checking |
| Beck Browser | Session persistence, authentication flow |
| Beck Converter | HTML parsing, Markdown output (existing tests) |

### Property Test Coverage

| Property | Test Strategy |
|----------|---------------|
| Interface Conformance | Generate mock providers, verify all required members |
| Tool Aggregation | Generate N providers with M tools each, verify union |
| Routing by Prefix | Generate tool names with various prefixes, verify routing |
| Error Handling | Generate error conditions, verify response structure |

### Test File Organization

```
src/
├── providers/
│   └── beck/
│       ├── converter.test.ts    # Existing converter tests (moved)
│       └── tools.test.ts        # Beck tool handler tests
├── shared/
│   └── types.test.ts            # Interface conformance tests
└── index.test.ts                # Orchestrator tests
```

### Integration Testing

Integration tests verify end-to-end behavior:
- Provider registration and tool listing
- Tool call routing through orchestrator
- Graceful shutdown sequence

Note: Integration tests requiring Beck Online authentication should be marked as requiring credentials and skipped in CI without credentials.
