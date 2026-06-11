# Blueprint: TheoCode — OpenCode Clone on TheoKit SDK

## Executive Summary

TheoCode is a production-grade coding agent that replicates 100% of OpenCode's functionality using `@theokit/sdk` as the foundation. OpenCode is a 24-package TypeScript monorepo built on Effect-TS that ships 20 tools, 12 LLM providers, session persistence via Drizzle+SQLite, context compaction, retry/revert, an ACP server, and a SolidJS-based TUI. This blueprint maps every subsystem to TheoKit equivalents: 27% map directly, 25% map partially, and 48% require new implementation. The critical insight is that OpenCode's agent loop is a streaming processor (not a state machine) that uses Vercel AI SDK's `streamText` for LLM calls and dispatches tools via a registry — TheoKit's `Agent.send()` + `defineTool()` can replicate this core loop, but session persistence, compaction, retry/revert, prompt profiles, and the TUI are entirely new work.

## 48-Row Feature Parity Matrix

| # | Feature | OpenCode file | TheoKit equivalent | Status | Effort |
|---|---------|--------------|-------------------|--------|--------|
| 1 | Agent loop (streaming) | `session/processor.ts:1-100` | `Agent.send()` + internal loop | PARTIAL | M |
| 2 | Tool dispatch + validation | `tool/tool.ts:99-169` | `defineTool()` | SIM | S |
| 3 | Output truncation | `tool/truncate.ts:1-50` | NEW | M |
| 4 | Permission system | `permission/` + `tool/tool.ts:113-130` | NEW (per-tool allow/deny/ask) | L |
| 5 | Agent profiles (build/plan/explore/general) | `agent/agent.ts:138-263` | NEW (agent config registry) | M |
| 6 | Subagent delegation | `tool/task.ts:81-346` | `@theokit/sdk` subagents PARTIAL | M |
| 7 | Background subagents | `tool/task.ts:291-294` | NEW | L |
| 8 | Read tool | `tool/read.ts` | `@theokit/sdk` defineTool | SIM | S |
| 9 | Write tool | `tool/write.ts` | `@theokit/sdk` defineTool | SIM | S |
| 10 | Edit tool (9 replacers) | `tool/edit.ts:244-728` | NEW (fuzzy edit matching) | L |
| 11 | Glob tool | `tool/glob.ts` | `@theokit/sdk` defineTool | SIM | S |
| 12 | Grep tool | `tool/grep.ts` | `@theokit/sdk` defineTool | SIM | S |
| 13 | Shell tool (tree-sitter) | `tool/shell.ts:257-657` | PARTIAL (no tree-sitter parse) | L |
| 14 | Apply-patch tool | `tool/apply_patch.ts` | NEW | M |
| 15 | WebFetch tool | `tool/webfetch.ts` | `@theokit/sdk` defineTool | SIM | S |
| 16 | WebSearch tool (Exa/Parallel) | `tool/websearch.ts` | NEW (provider integration) | M |
| 17 | Question tool (user interaction) | `tool/question.ts` | NEW (TUI interaction) | M |
| 18 | TodoWrite tool | `tool/todo.ts` | `@theokit/sdk` defineTool | SIM | S |
| 19 | Plan mode (enter/exit) | `tool/plan.ts` | NEW (agent switching) | M |
| 20 | Skill tool | `tool/skill.ts` | NEW (skill loader) | M |
| 21 | LSP tool | `tool/lsp.ts` | NEW (LSP bridge) | L |
| 22 | Invalid tool (repair) | `tool/invalid.ts` | NEW (tool-call repair) | S |
| 23 | MCP WebSearch | `tool/mcp-websearch.ts` | `@theokit/sdk` MCP | PARTIAL | S |
| 24 | External directory guard | `tool/external-directory.ts` | NEW (path security) | M |
| 25 | Session CRUD | `session/session.ts:461-514` | NEW (SQLite persistence) | L |
| 26 | Session forking | `session/session.ts:733-774` | NEW | M |
| 27 | Context compaction | `session/compaction.ts` | NEW (summarize + prune) | L |
| 28 | Overflow detection | `session/overflow.ts` | NEW | S |
| 29 | Retry with backoff | `session/retry.ts` | NEW (exponential + headers) | M |
| 30 | Session revert (git snapshot) | `session/revert.ts` | NEW (snapshot + undo) | L |
| 31 | Reminders | `session/reminders.ts` | NEW | S |
| 32 | Summary/title generation | `session/summary.ts` | PARTIAL (Agent.send for summary) | M |
| 33 | Run state management | `session/run-state.ts` | NEW (busy/idle tracking) | S |
| 34 | Message persistence (V2) | `session/message-v2.ts` | NEW (SQLite) | L |
| 35 | Prompt profiles (14 model-specific) | `session/prompt/*.txt` | NEW (template resolver) | M |
| 36 | LLM streaming (AI SDK + native) | `session/llm.ts` | `@theokit/sdk` providers | PARTIAL | M |
| 37 | Anthropic provider | `llm/providers/anthropic.ts` | `@theokit/sdk` provider catalog | SIM | S |
| 38 | OpenAI provider | `llm/providers/openai.ts` | `@theokit/sdk` provider catalog | SIM | S |
| 39 | Google provider | `llm/providers/google.ts` | `@theokit/sdk` provider catalog | SIM | S |
| 40 | OpenRouter/OpenAI-compat | `llm/providers/openrouter.ts` | `@theokit/sdk` provider catalog | SIM | S |
| 41 | Azure/Bedrock/Cloudflare/xAI/Copilot | `llm/providers/` | `@theokit/sdk` provider catalog | PARTIAL | M |
| 42 | ACP server (12 files) | `acp/service.ts` | `@theokit/acp` | PARTIAL | M |
| 43 | Event bus | `bus/global.ts` | NEW (EventEmitter-based) | S |
| 44 | Background jobs | `background/job.ts` | NEW (job queue) | M |
| 45 | Git integration | `git/index.ts` | NEW (simple-git wrapper) | M |
| 46 | IDE integration | `ide/index.ts` | NEW (VS Code protocol) | M |
| 47 | Image/vision handling | `image/image.ts` | PARTIAL (file attachments) | S |
| 48 | TUI (SolidJS/OpenTUI) | `tui/src/app.tsx` | NEW (React/Ink or SolidJS) | XL |

**Summary:** SIM=12, PARTIAL=8, NEW=28. Effort: S=14, M=18, L=10, XL=1.

## Q1: Agent Loop Architecture

### OpenCode's Architecture (session/processor.ts:1-100, session/llm.ts:85-355)

The agent loop is NOT a state machine. It is a **streaming processor** that:

1. **Prompt assembly** (`session/prompt.ts` + `session/llm/request.ts`): Assembles system prompt from model-specific profile (14 profiles in `session/prompt/*.txt`), injects CONTEXT.md, .opencode instructions, tool descriptions, skills list, and reminders. The system prompt is an array of strings, not one blob.

2. **LLM call** (`session/llm.ts:280-354`): Uses Vercel AI SDK `streamText()` with a middleware layer (`wrapLanguageModel`) for per-provider message transforms. Supports two runtimes: AI SDK (default) and native LLM client (opt-in via `experimentalNativeLlm` flag).

3. **Stream processing** (`session/processor.ts:36-53`): The `Handle.process()` method consumes `LLMEvent` stream events. For each event:
   - `text-delta` → append to current text part, publish to event bus
   - `tool-call-start` → create ToolPart with `status: "pending"`, request permission via `ctx.ask()`
   - `tool-call-complete` → execute tool, store result, mark `status: "completed"`
   - `tool-result` → feed back to LLM
   - `reasoning-delta` → append to reasoning part
   - `finish` → check for overflow, trigger compaction if needed

4. **Tool dispatch** (`tool/tool.ts:99-169`): Every tool call is wrapped: decode args via Effect Schema, execute, truncate output, add tracing span. Invalid tool calls are routed to an `InvalidTool` that asks the LLM to retry.

5. **Loop termination**: The loop continues while `streamText` returns tool calls. Termination: (a) LLM emits `stop` with no pending tool calls, (b) doom loop detected (3+ identical tool calls), (c) context overflow triggers compaction, (d) user abort.

### TheoKit Mapping

```
OpenCode processor.process()  →  TheoKit Agent.send() internal loop
OpenCode LLM.stream()         →  TheoKit provider.chat() via sdk providers
OpenCode ToolRegistry.tools() →  TheoKit defineTool() registry
OpenCode Permission.ask()     →  NEW: permission middleware
OpenCode Compaction.process() →  NEW: compaction agent
```

**Key gap:** TheoKit's `Agent.send()` handles the tool dispatch loop internally, but OpenCode exposes the streaming processor as a first-class abstraction with per-event hooks (tool-call-start, text-delta, etc.). TheoCode needs to use TheoKit's `Agent.streamObject()` or `Run.stream()` to get event-level access.

## Q2: Tool Parity Matrix (20 tools)

| Tool | OpenCode file | Input schema | Security | TheoKit equivalent | Status |
|------|--------------|-------------|----------|-------------------|--------|
| `read` | `tool/read.ts:28-36` | `{filePath, offset?, limit?}` | `assertExternalDirectory` + `ctx.ask(permission:"read")` + .env file gating | `defineTool("read",...)` | Build from scratch — needs binary detection, image/PDF support, line truncation |
| `write` | `tool/write.ts:22-25` | `{content, filePath}` | `assertExternalDirectory` + `ctx.ask(permission:"edit")` + BOM preservation | `defineTool("write",...)` | Build — needs LSP diagnostics, formatter integration |
| `edit` | `tool/edit.ts:47-56` | `{filePath, oldString, newString, replaceAll?}` | Same as write + file lock (Semaphore) | NEW | Build — the 9-stage replacer chain (`edit.ts:694-729`) is the crown jewel: Simple → LineTrimmed → BlockAnchor → WhitespaceNormalized → IndentationFlexible → EscapeNormalized → TrimmedBoundary → ContextAware → MultiOccurrence |
| `glob` | `tool/glob.ts:11-15` | `{pattern, path?}` | `assertExternalDirectory` | `defineTool("glob",...)` | Straightforward — uses ripgrep `--glob` |
| `grep` | `tool/grep.ts:10-18` | `{pattern, path?, include?}` | `assertExternalDirectory` | `defineTool("grep",...)` | Straightforward — uses ripgrep |
| `bash` (shell) | `tool/shell.ts:344-657` | `{command, description, timeout?, workdir?}` | Tree-sitter parse → extract file paths → check external dirs → permission ask | NEW | Complex — tree-sitter bash/powershell parsing for security, timeout, output streaming to temp file |
| `apply_patch` | `tool/apply_patch.ts:18-20` | `{patchText}` | Same as edit | NEW | Unified diff parser + apply — used for GPT models instead of edit/write |
| `webfetch` | `tool/webfetch.ts:13-22` | `{url, format, timeout?}` | Permission ask + 5MB limit + Cloudflare bypass | `defineTool("webfetch",...)` | Build — needs HTML→markdown (turndown), image handling |
| `websearch` | `tool/websearch.ts:14-25` | `{query, numResults?, livecrawl?, type?, contextMaxCharacters?}` | Permission ask + provider selection (Exa/Parallel) | NEW | Needs MCP WebSearch protocol integration |
| `task` | `tool/task.ts:56-62` | `{description, prompt, subagent_type, task_id?, command?, background?}` | Permission ask per subagent type | PARTIAL (TheoKit subagents) | Complex — creates child session, delegates to subagent, supports background mode with job notification |
| `question` | `tool/question.ts:6-8` | `{questions: [{question, options?, header?}]}` | Permission deny by default (enabled per agent) | NEW | TUI interaction — presents questions to user, collects answers |
| `todowrite` | `tool/todo.ts:17-19` | `{todos: [{content, status, priority}]}` | Permission ask | `defineTool("todowrite",...)` | Simple — persists todo state per session |
| `plan_exit` | `tool/plan.ts` | `{}` | Permission deny by default | NEW | Agent switching — asks user to switch from plan→build agent |
| `skill` | `tool/skill.ts:9-11` | `{name}` | Permission ask | NEW | Loads SKILL.md from `.opencode/skills/` directories |
| `lsp` | `tool/lsp.ts:11-35` | `{operation, filePath, line, character, query?}` | `assertExternalDirectory` | NEW | LSP bridge — goToDefinition, findReferences, hover, symbols, call hierarchy |
| `invalid` | `tool/invalid.ts` | `{tool, error}` | None (internal) | NEW | Catches malformed tool calls, asks LLM to retry with correct schema |
| `mcp-websearch` | `tool/mcp-websearch.ts` | MCP protocol | Via MCP server | PARTIAL (TheoKit MCP) | MCP server bridge for external search |
| `external-directory` | `tool/external-directory.ts` | Internal guard | Path containment check | NEW | Security — checks if path is within project or whitelisted dirs |
| `truncation-dir` | `tool/truncation-dir.ts` | Internal | None | NEW | Temp dir for large outputs |
| `truncate` | `tool/truncate.ts` | Internal service | None | NEW | Output size management — MAX_LINES=2000, MAX_BYTES=50KB |

## Q3: Session Lifecycle

### Lifecycle Diagram

```
CREATE → ACTIVE → [BUSY → STREAMING → TOOL_DISPATCH]* → IDLE
                     ↓
                  OVERFLOW → COMPACTION → CONTINUE/STOP
                     ↓
                  RETRY (exponential backoff)
                     ↓
                  REVERT (git snapshot restore)
                     ↓
                  ARCHIVE / REMOVE
```

### Session CRUD (`session/session.ts:461-514`)

The `Session.Interface` exposes: `create`, `get`, `list`, `listGlobal`, `fork`, `remove`, `touch`, `setTitle`, `setArchived`, `setMetadata`, `setPermission`, `setRevert`, `clearRevert`, `setSummary`, `setShare`, `setWorkspace`, `diff`, `messages`, `children`, `updateMessage`, `removeMessage`, `updatePart`, `removePart`, `getPart`, `updatePartDelta`, `findMessage`.

Key schema fields (`session/session.ts:213-233`): `id`, `slug`, `projectID`, `workspaceID`, `directory`, `path`, `parentID` (for child sessions), `title`, `agent`, `model`, `version`, `summary` (additions/deletions/files), `cost`, `tokens` (input/output/reasoning/cache), `share`, `metadata`, `time`, `permission`, `revert`.

### Compaction (`session/compaction.ts`)

Triggered when token count exceeds `usable(model)` threshold (`overflow.ts:22-34`). The compaction system:
1. **Prune** old tool outputs (PRUNE_MINIMUM=20K, PRUNE_PROTECT=40K tokens)
2. **Select** tail turns to preserve (budget-based, default 2 turns, 2K-8K tokens)
3. **Summarize** via dedicated "compaction" agent with model-specific prompt
4. **Auto-continue** after compaction with synthetic user message

### Retry (`session/retry.ts`)

Exponential backoff with header-aware delays:
- `retry-after-ms` header → use exact value
- `retry-after` header → parse seconds or HTTP date
- No headers → `2000 * 2^(attempt-1)`, max 30s
- Max delay: MAX_INT32 (for header-based delays)
- Not retried: context overflow errors, non-5xx without `isRetryable` flag
- Special: FreeUsageLimitError → upsell message + link

### Revert (`session/revert.ts`)

Git-based undo:
1. Track snapshot before first edit (via `Snapshot.track()`)
2. On revert: restore snapshot, replay patches in reverse
3. On unrevert: restore to snapshot state
4. Cleanup: remove messages after revert point

### TheoKit Gaps

- **Session persistence:** TheoKit has `better-sqlite3` for memory but no session table. Needs new schema.
- **Compaction:** TheoKit has `autoSummarize` and `compositeScore` for memory but no context compaction for the agent loop itself.
- **Retry:** TheoKit has no built-in retry with header-aware backoff.
- **Revert:** Entirely new — requires git integration.

## Q4: Persistence Layer

### OpenCode: Drizzle + SQLite + Effect

OpenCode uses `@opencode-ai/core/database/database` with Drizzle ORM over SQLite:
- `SessionTable`, `PartTable`, `ProjectTable` in `@opencode-ai/core/session/sql`
- Event-sourced: writes go through `EventV2Bridge.publish()` which triggers subscriptions
- Messages stored as `PartTable` rows with `session_id`, `message_id`, `data` (JSON blob)
- Pagination via cursor-based `MessageV2.page()` — newest-first

### TheoKit: better-sqlite3 + sqlite-vec

TheoKit already has:
- `better-sqlite3` for memory persistence (Active Memory, dreaming)
- `sqlite-vec` for vector search
- No session/message schema

### Strategy

Reuse TheoKit's existing `better-sqlite3` connection. Add new tables:
```sql
CREATE TABLE sessions (id TEXT PRIMARY KEY, slug TEXT, title TEXT, agent TEXT, model JSON, 
  cost REAL, tokens_input INT, tokens_output INT, tokens_reasoning INT, 
  tokens_cache_read INT, tokens_cache_write INT, time_created INT, time_updated INT, ...);
CREATE TABLE messages (id TEXT, session_id TEXT, role TEXT, data JSON, 
  PRIMARY KEY (session_id, id));
CREATE TABLE parts (id TEXT, session_id TEXT, message_id TEXT, data JSON,
  PRIMARY KEY (session_id, message_id, id));
```

No Drizzle dependency — use raw `better-sqlite3` prepared statements (KISS, per existing SDK patterns).

## Q5: LLM Provider Coverage

### OpenCode Providers (`llm/package.json` exports)

| Provider | OpenCode file | Protocol | TheoKit equivalent |
|----------|--------------|----------|-------------------|
| Anthropic | `providers/anthropic.ts` | anthropic-messages | `@theokit/sdk` provider #1 |
| OpenAI | `providers/openai.ts` | openai-chat, openai-responses | `@theokit/sdk` provider #2 |
| Google | `providers/google.ts` | gemini | `@theokit/sdk` provider |
| Azure | `providers/azure.ts` | openai-chat | `@theokit/sdk` provider |
| Amazon Bedrock | `providers/amazon-bedrock.ts` | bedrock-converse | `@theokit/sdk` Bedrock |
| Cloudflare | `providers/cloudflare.ts` | openai-compatible-chat | `@theokit/sdk` via OpenAI-compat |
| GitHub Copilot | `providers/github-copilot.ts` | openai-chat | NEW (OAuth flow) |
| OpenRouter | `providers/openrouter.ts` | openai-compatible-chat | `@theokit/sdk` provider |
| xAI | `providers/xai.ts` | openai-compatible-chat | `@theokit/sdk` via OpenAI-compat |
| OpenAI-compatible | `providers/openai-compatible.ts` | openai-compatible-chat | `@theokit/sdk` OpenAI-compat |
| OpenAI-compat-profile | `providers/openai-compatible-profile.ts` | openai-compatible-chat | `@theokit/sdk` OpenAI-compat |

**Protocols** (6): anthropic-messages, bedrock-converse, gemini, openai-chat, openai-compatible-chat, openai-responses.

**Runtime dependencies** (`llm/package.json:48-50`): `@smithy/eventstream-codec` (Bedrock), `aws4fetch` (AWS signing), `effect`.

**TheoKit coverage:** TheoKit ships 43+ providers. All OpenCode providers except GitHub Copilot are already covered. **Gap: GitHub Copilot OAuth flow.**

## Q6: Prompt Profile System

### 14 Model-Specific Profiles (`session/prompt/*.txt`)

| Profile | File | When selected |
|---------|------|--------------|
| `default` | `default.txt` (96 lines) | Fallback for all models |
| `anthropic` | `anthropic.txt` | providerID contains "anthropic" |
| `gpt` | `gpt.txt` | modelID starts with "gpt-" |
| `gemini` | `gemini.txt` | providerID contains "google" |
| `beast` | `beast.txt` | When "beast mode" enabled |
| `codex` | `codex.txt` | modelID contains "codex" |
| `copilot-gpt-5` | `copilot-gpt-5.txt` | GitHub Copilot GPT-5 |
| `kimi` | `kimi.txt` | modelID contains "kimi" |
| `trinity` | `trinity.txt` | modelID contains "trinity" |
| `plan` | `plan.txt` | Agent is "plan" |
| `plan-mode` | `plan-mode.txt` | Plan mode active |
| `plan-reminder-anthropic` | `plan-reminder-anthropic.txt` | Plan + Anthropic |
| `max-steps` | `max-steps.txt` | Max iteration reminder |
| `build-switch` | `build-switch.txt` | After plan→build switch |

### 4 Utility Prompts (`agent/prompt/*.txt`)

| Prompt | File | Purpose |
|--------|------|---------|
| `compaction` | `compaction.txt` | Context summarization |
| `explore` | `explore.txt` | Codebase exploration agent |
| `summary` | `summary.txt` | Session summary/diff generation |
| `title` | `title.txt` | Auto-title generation |

### Default Prompt Content (`session/prompt/default.txt:1-96`)

The default system prompt (`default.txt`) establishes:
- Identity: "You are opencode, an interactive CLI tool"
- Tone: Concise, direct, < 4 lines, no emojis, no preamble
- Proactiveness: Act when asked, don't surprise
- Conventions: Check existing libs, match code style, no comments unless asked
- Task workflow: Search → implement → verify → lint/typecheck
- Tool policy: Batch calls, use Task tool for search

### TheoKit Mapping

TheoKit's `systemPrompt` accepts a string or resolver function. TheoCode implements:
```typescript
function resolvePrompt(model: ModelInfo, agent: AgentProfile): string {
  const profile = selectProfile(model) // match by provider/model ID
  const base = loadTemplate(profile)   // load .txt file
  return [base, ...injections].join('\n')  // CONTEXT.md, skills, reminders
}
```

## Q7: ACP Architecture

### 12 Files in `acp/`

| File | Purpose | Lines |
|------|---------|-------|
| `service.ts` | Main ACP service — 12 methods (initialize, authenticate, newSession, loadSession, listSessions, resumeSession, closeSession, forkSession, setSessionConfigOption, setSessionMode, setSessionModel, prompt, cancel) | ~1049 |
| `session.ts` | ACP session state management (in-memory) | ~150 |
| `event.ts` | Event subscription — bridges OpenCode events to ACP events | ~200 |
| `content.ts` | Converts ACP prompt content to SDK parts (text, image, embedded context) | ~100 |
| `directory.ts` | Directory snapshots — loads providers, agents, commands, skills per workspace | ~200 |
| `config-option.ts` | Builds config options for ACP (model selector, effort/variant, mode) | ~150 |
| `error.ts` | ACP error types (AuthRequired, InvalidModel, InvalidEffort, etc.) | ~50 |
| `permission.ts` | Permission bridging between ACP and OpenCode | ~50 |
| `profile.ts` | Performance profiling for ACP operations | ~30 |
| `tool.ts` | ACP tool type bridging | ~50 |
| `usage.ts` | Token usage tracking + cost calculation for ACP | ~100 |
| `agent.ts` | ACP agent configuration | ~50 |

### ACP Protocol

The ACP service (`acp/service.ts:54-70`) implements the `@agentclientprotocol/sdk` interface:
- **Initialize:** Returns agent capabilities (MCP, prompt with embedded context + images, session operations)
- **NewSession:** Creates backing OpenCode session, registers MCP servers, returns config options
- **Prompt:** Converts ACP content to parts, detects slash commands, calls `sdk.session.prompt()`
- **Session lifecycle:** load, list, resume, close, fork — all delegate to the backing OpenCode session

### TheoKit Mapping

TheoKit ships `@theokit/acp` package. The ACP service maps cleanly:
- `initialize` → TheoKit ACP server capabilities
- `newSession` / `loadSession` → TheoCode session management
- `prompt` → `Agent.send()` with parts conversion
- **Gap:** TheoKit's `@theokit/acp` needs the config-option system (model/effort/mode selectors)

## Q8: Test Architecture

### Test Files Found

20 test files under `packages/opencode/test/`:
- `snapshot/snapshot.test.ts` — Git snapshot operations
- `image/image.test.ts` — Image detection/processing
- `util/` — 8 utility tests (filesystem, wildcard, glob, error, data-url, timeout, lazy, module, process, iife)
- `skill/` — 2 tests (discovery, skill loading)
- `patch/patch.test.ts` — Unified diff parsing
- `git/git.test.ts` — Git operations
- `pty/pty-shell.test.ts` — PTY shell integration
- `effect/` — 2 tests (runtime-flags, config-service)

### Strategy

OpenCode uses **Bun test** (`bun test --timeout 30000`). Tests are mostly unit tests for utilities and integration tests for the git/snapshot/pty subsystems. There are NO end-to-end agent loop tests with real LLM calls in the reference (the LLM package has its own test suite with HTTP recording).

### TheoCode Test Strategy

- **Unit:** Tool implementations (edit replacers, truncation, permission evaluation)
- **Integration:** Session persistence (SQLite), compaction, retry
- **E2E (env-gated):** Full agent loop with real LLM (per `rules/real-llm-validation.md`)
- **Framework:** Vitest (per TheoKit locked toolchain)

## Q9: TUI Architecture

### OpenCode TUI (`tui/src/app.tsx:1-1100`)

**Framework:** SolidJS + `@opentui/solid` (custom terminal UI renderer at 60fps). NOT React/Ink.

**Component Tree (from `app.tsx:236-317`):**
```
ExitProvider > EpilogueProvider > ErrorBoundary > 
  TuiPathsProvider > TuiTerminalEnvironmentProvider > TuiStartupProvider >
    ClipboardProvider > OpencodeKeymapProvider > ArgsProvider > KVProvider >
      ToastProvider > RouteProvider > TuiConfigProvider > PluginRuntimeProvider >
        SDKProvider > ProjectProvider > SyncProvider > DataProvider >
          ThemeProvider > LocalProvider > PromptStashProvider >
            DialogProvider > FrecencyProvider > PromptHistoryProvider >
              PromptRefProvider > EditorContextProvider > <App />
```

**Routes:** `Home` (session list) and `Session` (chat view).

**Key Components (from `tui/src/component/`):**
- `dialog-model.tsx` — Model picker
- `dialog-agent.tsx` — Agent picker
- `dialog-session-list.tsx` — Session switcher
- `dialog-mcp.tsx` — MCP toggle
- `dialog-status.tsx` — Status view
- `command-palette.tsx` — Command palette (Ctrl+K)
- `prompt/` — Input prompt with history, stash, frecency

**Keymap system (`keymap.tsx`):** Mode-based keybindings (OPENCODE_BASE_MODE), with commands like `session.list`, `model.list`, `agent.cycle`, etc.

### TheoCode TUI Strategy

**Minimum viable TUI** (Phase 5):
1. **Framework:** Use `@opentui/solid` (same as OpenCode) OR `ink` (React) — decision required
2. **MVP components:** Prompt input, message display (markdown), tool call display, model picker, session list
3. **Skip for MVP:** Plugin system, clipboard integration, theme system, workspace management

## Q10: Infrastructure Systems

### Event Bus (`bus/global.ts:1-18`)

Simple `EventEmitter` singleton with typed events. Each event has `{directory?, project?, workspace?, payload}`. Auto-assigns ascending IDs. Used for cross-component communication (session events, file edits, watcher updates).

**TheoKit mapping:** TheoKit has `EventEmitter` patterns internally. TheoCode can use a simple typed event bus.

### Background Jobs (`background/job.ts`)

Job queue with states: `running`, `completed`, `error`, `cancelled`. Supports:
- `start(id, run, onPromote)` — register a job
- `wait(id)` — wait for completion
- `cancel(id)` — abort
- `extend(id, run)` — add work to existing job
- `list()` — enumerate jobs
- `waitForPromotion(id)` — wait for foreground→background promotion

Used by `task.ts` for background subagents.

**TheoKit mapping:** NEW. Simple in-memory job queue with Effect fiber management.

### Control Plane / Workspace (`control-plane/workspace.ts`)

Workspace management — multiple worktrees per project, workspace switching, directory-scoped sessions.

**TheoKit mapping:** NEW but low priority. TheoCode MVP can use single workspace.

### Git Integration (`git/index.ts`)

Git operations: status, diff, commit, snapshot (stash-like), restore. Used by revert system and summary (additions/deletions tracking).

**TheoKit mapping:** NEW. Use `simple-git` or shell out to `git` directly.

### IDE Integration (`ide/index.ts`)

Bridges to VS Code, Cursor, Windsurf — opens files at line:col, manages editor lifecycle.

**TheoKit mapping:** NEW but low priority for CLI-first TheoCode.

### Image Handling (`image/image.ts`)

Detects image MIME types, converts to base64 data URLs for LLM vision. Supports JPEG, PNG, GIF, WebP.

**TheoKit mapping:** PARTIAL — TheoKit's message types support file attachments. Need MIME detection.

### Formatter (`format/formatter.ts`)

Auto-formats files after write/edit using project-configured formatter (prettier, biome, etc.).

**TheoKit mapping:** NEW. Shell out to formatter after file writes.

## Phased Implementation Plan

### Phase 1: Core Tools (1 week)
- **T1.1** Read tool with binary detection, line truncation, image/PDF support
- **T1.2** Write tool with BOM preservation, formatter integration
- **T1.3** Edit tool with 9-stage replacer chain (the hardest tool)
- **T1.4** Glob tool (simple ripgrep wrapper)
- **T1.5** Grep tool (simple ripgrep wrapper)
- **T1.6** Shell tool (basic — tree-sitter deferred to Phase 3)
- **T1.7** Output truncation service (MAX_LINES=2000, MAX_BYTES=50KB)
- **T1.8** Invalid tool (tool-call repair)
- **T1.9** External directory guard (path containment)

### Phase 2: Session Persistence + Retry/Revert (2 weeks)
- **T2.1** SQLite schema for sessions, messages, parts
- **T2.2** Session CRUD (create, get, list, remove, fork)
- **T2.3** Message persistence with cursor-based pagination
- **T2.4** Context compaction (summarize agent + prune old tool outputs)
- **T2.5** Overflow detection (token count vs model limit)
- **T2.6** Retry with exponential backoff + header-aware delays
- **T2.7** Session revert with git snapshot
- **T2.8** Run state management (busy/idle)
- **T2.9** Summary/title generation agent

### Phase 3: Prompt Profiles + LLM + Advanced Tools (1 week)
- **T3.1** Prompt profile resolver (14 model-specific profiles)
- **T3.2** Skill tool (load SKILL.md from project dirs)
- **T3.3** Apply-patch tool (unified diff for GPT models)
- **T3.4** WebSearch tool (Exa/Parallel integration)
- **T3.5** WebFetch tool with HTML→markdown
- **T3.6** Shell tool upgrade (tree-sitter parsing for security)
- **T3.7** LSP tool bridge

### Phase 4: Infrastructure (2 weeks)
- **T4.1** Event bus (typed EventEmitter)
- **T4.2** Background job queue
- **T4.3** Permission system (allow/deny/ask per tool per agent)
- **T4.4** Agent profiles (build, plan, explore, general, compaction, title, summary)
- **T4.5** Subagent delegation with background mode
- **T4.6** Git integration (status, diff, snapshot)
- **T4.7** ACP server integration with `@theokit/acp`
- **T4.8** Plan mode (enter/exit, agent switching)
- **T4.9** TodoWrite + Question tools

### Phase 5: TUI (2 weeks)
- **T5.1** Framework decision (opentui/solid vs ink/React)
- **T5.2** Core layout (prompt input + message display)
- **T5.3** Tool call display (collapsible, with output preview)
- **T5.4** Model picker dialog
- **T5.5** Session list + switcher
- **T5.6** Agent picker
- **T5.7** Command palette
- **T5.8** Keymap system
- **T5.9** Theme system (dark/light)

## New SDK Features Required

| Feature | Why needed | Can build with existing primitives? |
|---------|-----------|--------------------------------------|
| Session persistence (SQLite) | Coding agent needs multi-session support | YES — use existing `better-sqlite3` |
| Context compaction | Long conversations exceed context limits | PARTIAL — needs compaction agent + token counting |
| Retry with backoff | LLM rate limits and transient failures | YES — wrap Agent.send() |
| Session revert | Undo file changes from a session | NO — needs git snapshot integration |
| Permission system | Per-tool allow/deny/ask | PARTIAL — TheoKit has middleware hooks |
| Agent profiles | Multiple agent personalities (build/plan/explore) | YES — `Agent.create()` with different configs |
| Background jobs | Async subagent execution | YES — use Node worker threads or fibers |
| Output truncation | Large tool outputs exceed context | YES — utility function |
| Prompt profiles | Model-specific system prompts | YES — `systemPrompt` resolver function |

**Verdict:** No new SDK primitives needed. All features are buildable with existing `@theokit/sdk` + standard Node.js. The SDK's `Agent.create()`, `defineTool()`, `Agent.send()`, and provider system cover the core agent loop. Session persistence, compaction, and revert are application-level features that sit on top of the SDK.

## Coverage Corners

### Integration Tests corner
- Session persistence: create → messages → compaction → list roundtrip
- Tool chain: edit 9-stage replacer accuracy across edge cases (whitespace, indentation, escape sequences)
- Retry: mock 429 responses → verify backoff timing + header parsing
- Revert: edit files → revert → verify git state matches pre-edit

### Dependencies corner
- `better-sqlite3` (existing) — session/message persistence
- `ripgrep` (existing via shell) — glob/grep tools
- `diff` (npm) — edit tool diff generation
- `turndown` (npm) — HTML→markdown for webfetch
- `htmlparser2` (npm) — HTML text extraction
- `web-tree-sitter` + `tree-sitter-bash` — shell tool security (Phase 3)
- `simple-git` or git CLI — revert/snapshot system
- `@opentui/solid` OR `ink` — TUI framework (Phase 5)

### Tools corner
- Vitest — test framework (locked toolchain)
- tsup — build (locked toolchain)
- Biome — lint/format (locked toolchain)
- ripgrep — glob/grep backend (runtime dependency)
- git — revert/snapshot (runtime dependency)

### Techniques corner
- **Streaming processor pattern** — consume LLM events, dispatch tools, loop until stop/overflow
- **9-stage fuzzy edit** — cascading replacer chain for robust find-and-replace
- **Token-budget compaction** — summarize old turns, preserve recent N turns within budget
- **Header-aware retry** — parse `retry-after` / `retry-after-ms` for optimal backoff
- **Git snapshot revert** — track state before edits, restore on demand
- **Permission middleware** — per-tool, per-pattern, per-agent allow/deny/ask rules
- **Prompt profile resolution** — model-specific system prompts selected by provider/model ID matching
