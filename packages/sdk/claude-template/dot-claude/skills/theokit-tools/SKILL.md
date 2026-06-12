---
user-invocable: false
description: Custom tools, defineTool with Zod schemas, and built-in coding tools for @theokit/sdk.
paths:
  - "**/*tool*"
  - "**/*Tool*"
---

# TheoKit SDK -- Tools

Quick reference for custom inline tools and built-in coding tools.

## defineTool (type-safe builder)

```typescript
import { z } from "zod";
import { defineTool } from "@theokit/sdk";

const rollTool = defineTool({
  name: "roll",
  description: "Roll N dice with S sides each.",
  inputSchema: z.object({
    count: z.number().int().min(1).max(100),
    sides: z.number().int().min(2).max(1000),
  }),
  handler: ({ count, sides }) => {
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
    return JSON.stringify({ rolls, total: rolls.reduce((a, b) => a + b, 0) });
  },
});
```

Requires `zod` as a peer dependency. Converts Zod schema to JSON Schema for the LLM. Runtime `schema.parse` validates input before the handler runs. Invalid input becomes `tool_result(isError)` with a Zod message.

### DefineToolSpec

```typescript
interface DefineToolSpec<T extends ZodType> {
  name: string;
  description: string;
  inputSchema: T;
  handler: (input: z.infer<T>) => string | Promise<string>;
}
```

## CustomTool (raw interface)

```typescript
interface CustomTool {
  name: string;          // /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema, type: "object"
  handler: (input: Record<string, unknown>) => string | Promise<string>;
}
```

### Reserved names (rejected at create time)

`shell`, `memory_search`, `memory_get`, anything prefixed with `mcp_`.

### Constraints

- **Local runtime only.** Cloud agents throw `ConfigurationError(code: "cloud_custom_tools_rejected")` when `tools.length > 0`.
- **Not persisted.** Handlers are in-memory closures. Re-pass tools on `Agent.resume`.

## Registering tools with agents

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
  tools: [rollTool, lookupTool],
});
```

### Per-send tool override

```typescript
await agent.send("Use only the calculator.", {
  tools: [calculatorTool], // fully replaces agent-level tools for this run
});
// tools: undefined -> fall back to agent tools
// tools: []        -> no custom tools for this run
```

## Built-in coding tools (`@theokit/sdk/tools`)

Drop-in toolkit for coding agents. All tools are project-scoped and refuse sensitive files.

```typescript
import { createAgentFactory } from "@theokit/sdk";
import {
  createReadFileTool,
  createListDirTool,
  createSearchTextTool,
  createGitDiffTool,
  createRunVitestTool,
} from "@theokit/sdk/tools";

const projectRoot = process.cwd();
const factory = createAgentFactory({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: { id: "claude-sonnet-4-6" },
  tools: [
    createReadFileTool({ projectRoot }),
    createListDirTool({ projectRoot }),
    createSearchTextTool({ projectRoot, maxMatches: 100 }),
    createGitDiffTool({ projectRoot, timeoutMs: 30_000 }),
    createRunVitestTool({ projectRoot, timeoutMs: 120_000 }),
  ],
});
```

### Tool reference

| Tool | Returns on success | Error codes |
|---|---|---|
| `read_file` | `{ ok, content, size }` | `path_traversal`, `forbidden_path`, `binary_file`, `not_found`, `too_large` |
| `list_dir` | `{ ok, entries: [{ name, type }], truncated, totalCount }` | `path_traversal`, `forbidden_path` |
| `search_text` | `{ ok, matches: [{ file, line, preview }], truncated }` | `path_traversal`, `forbidden_path` |
| `git_diff` | `{ ok, diff, truncated }` | `not_a_repo`, `timeout`, `git_failed`, `path_traversal` |
| `run_vitest` | `{ ok, summary: { numTotalTests, numPassedTests, numFailedTests, success } }` | `no_vitest`, `timeout`, `unparseable_output`, `path_traversal` |

### Safety rules (shared across all 5 tools)

1. Every I/O call passes through `safePathJoin` + `assertNoSymlinkEscape`.
2. Sensitive files refused: `.env*` (except `.env.example`), `.git/`, `node_modules/`, `.theo/`, lock files.
3. Handlers return JSON strings; never throw on user mistakes.

### Hardening

- `read_file`: rejects binary files via null-byte detection in first 8 KB. Caps at 5 MB.
- `list_dir`: caps at 500 entries by default (override via `max`).
- `search_text`: skips binary files and files > 1 MB.
- `git_diff` / `run_vitest`: spawn detached process groups; on timeout kill the whole group.

## Tool lifecycle hooks

```typescript
const agent = await Agent.create({
  apiKey, model,
  onToolStart: ({ toolName, callId, args, conversationId }) => { /* ... */ },
  onToolEnd: ({ toolName, callId, durationMs, result }) => { /* ... */ },
  onToolError: ({ toolName, callId, error, durationMs, attempt }) => { /* ... */ },
});
```

- `callId` correlates start/end pairs.
- Hook errors are swallowed -- listener bugs do NOT crash the agent run.

## Tool stream events

Tool calls emit `SDKToolUseMessage` (type `"tool_call"`) twice: once with `status: "running"` and `args`, then with `status: "completed"` (or `"error"`) and `result`. The `args` and `result` payloads are unstable -- parse defensively.

## Path safety utilities (`@theokit/sdk/path-safety`)

```typescript
import {
  safePathJoin,
  assertNoSymlinkEscape,
  isForbiddenPath,
  PathTraversalError,
  ForbiddenPathError,
} from "@theokit/sdk/path-safety";

const safe = safePathJoin(projectRoot, userPath);
assertNoSymlinkEscape(safe, projectRoot);
if (isForbiddenPath(userPath)) throw new ForbiddenPathError(userPath);
```
