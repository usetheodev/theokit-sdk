# Theo Harness Capability Map

A single navigable index of **what the Theo harness gives you** — every public
primitive with its real import path, a one-line description, and a minimal
example. The goal: find `compactTranscript`, `buildRepoMap`, `isTransientError`,
or any other capability **without reading source**.

- Every `import` line below resolves against the published packages — verified by the committed resolve-check `scripts/check-capability-map.mjs` (run it after `pnpm --filter @theokit/sdk build`; intended to be wired into CI).
- Public `@theokit/sdk/*` and `@theokit/sdk-tools` sub-paths are **semver-protected**. The `@theokit/sdk/internal/*` sub-paths are **semver-exempt** (may break) — prefer the public homes listed here.
- The canonical, exhaustive API contract is [`docs.md`](../docs.md); this map is the discovery front-door, organized by capability.

> Scope: this map covers the **Harness** packages in this repo — `@theokit/sdk` and `@theokit/sdk-tools`. Capabilities that live in sibling repos (UI, the `theokit` HTTP framework, ORM, memory adapters) are listed under [Out-of-repo capabilities](#out-of-repo-capabilities) with a pointer.

---

## Agent runtime core — `@theokit/sdk`

```typescript
import {
  Agent,                      // Agent.create({ model, apiKey, tools, ... }) → agent; agent.send(msg) → run
  createAgentFactory,         // createAgentFactory(defaults) → reusable agent builder
  AgentBuilder,               // fluent agent construction
  defineTool,                 // defineTool({ name, description, inputSchema, handler }) → CustomTool
  definePlugin,               // definePlugin({ hooks }) → Plugin (pre/post tool-call, etc.)
  defineProvider,             // defineProvider(...) → custom LLM provider
  PermissionEngine,           // permission decisions for tool calls (default-allow; pluggable)
  createPermissionPlugin,     // wrap a permission policy as a Plugin
  createCounterBudgetTracker, // createCounterBudgetTracker({ maxIterations }) → BudgetTracker (enforced step cap)
  Budget, UsageAccumulator,   // usage/cost accounting
  buildReplayHistory,         // buildReplayHistory(base, events, { contextWindowTokens }) → StoredMessage[] (stateless loop replay)
  computeCost, normalizeUsage, getPricingEntry, // cost helpers (never 0 when pricing unknown)
  createSquad, Task,          // multi-agent + task primitives
  Theokit, Cron,              // top-level namespaces (Theokit.models.list(), Cron.create(...))
} from "@theokit/sdk";

// Step cap fail-closed in one line:
const agent = await Agent.create({
  model: { id: "anthropic/claude-3-5-sonnet" },
  apiKey: process.env.OPENROUTER_API_KEY,
  budgetTracker: createCounterBudgetTracker({ maxIterations: 50 }), // stops + sets RunResult.stoppedAtIterationLimit
});
```

## Errors & transient classification — `@theokit/sdk/errors`

```typescript
import {
  isTransientError,    // isTransientError(err) → boolean (429/5xx/network/ECONNRESET on TheokitAgentError) — the single retry taxonomy
  TheokitAgentError,   // base error class (all SDK errors extend it)
  RateLimitError, NetworkError, AuthenticationError, ConfigurationError, // typed subclasses
} from "@theokit/sdk/errors"; // NOTE: import isTransientError + classes from this subpath OR the barrel — use ONE entry consistently (cross-entry instanceof is class-identity sensitive)

if (isTransientError(err)) await retry();
```

## Retry — `@theokit/sdk/retry`

```typescript
import { withRetry } from "@theokit/sdk/retry";
// withRetry(fn, { retries, isRetryable, initialDelayMs, maxDelayMs, backoffMultiplier, sleep, signal })
const res = await withRetry(() => callApi(), { retries: 3, isRetryable: isTransientError, initialDelayMs: 200 });
```

## Concurrency — `@theokit/sdk/concurrency`

```typescript
import { mapWithConcurrency, createSemaphore } from "@theokit/sdk/concurrency";
// mapWithConcurrency(items, concurrency, fn) → ordered results, bounded pool
const out = await mapWithConcurrency(tasks, 8, async (t) => run(t));
```

## Context & compaction — `@theokit/sdk/compaction`

```typescript
import {
  estimateTokens,            // estimateTokens(text) → ceil(len/4) tokenizer-free estimate
  shouldCompact,             // shouldCompact({ estimated, contextWindow, buffer }) → boolean (pre-call gate)
  compactTranscript,         // compactTranscript(messages, { keepRecent, summarize }) → CompressibleMessage[]
  buildCheckpoint,           // buildCheckpoint(label?) → a checkpoint system turn
  filterFromLatestCheckpoint,// filterFromLatestCheckpoint(messages) → turns after the latest checkpoint
  CHECKPOINT_MARKER,         // sentinel prefix for checkpoint turns
  isContextOverflowError,    // isContextOverflowError(err) → boolean (typed context_too_long, not regex)
} from "@theokit/sdk/compaction";

if (shouldCompact({ estimated: estimateTokens(joined), contextWindow: 200_000, buffer: 20_000 })) {
  messages = await compactTranscript(messages, { keepRecent: 6, summarize });
}
```

## SDKMessage readers — `@theokit/sdk/messages`

```typescript
import { assistantText, extractToolUses, costAmountUsd } from "@theokit/sdk/messages";
// assistantText(msg) → string|undefined; extractToolUses(msg) → tool calls; costAmountUsd(msg) → number|undefined (never 0 when unknown)
for await (const msg of run.stream()) { const text = assistantText(msg); if (text) ui.append(text); }
```

## Model catalog — `@theokit/sdk/models`

```typescript
import { resolveModelCapabilities, parseModelId, humanizeModelName, toModelOption } from "@theokit/sdk/models";
// resolveModelCapabilities(modelId) → { contextWindow, ... } | undefined (sync, offline)
const caps = resolveModelCapabilities("anthropic/claude-3-5-sonnet");
const label = humanizeModelName("openai/gpt-4o"); // → "GPT-4o"
```

## Skills discovery — `@theokit/sdk/skills`

```typescript
import { discoverSkills, buildSkillsBlock } from "@theokit/sdk/skills";
// discoverSkills(dir) → Skill[] from an arbitrary directory convention; buildSkillsBlock(skills) → <skills> prompt block
const block = buildSkillsBlock(await discoverSkills(".theo/skills"));
```

## Project instructions — `@theokit/sdk/project`

```typescript
import { readProjectInstructions, writeProjectInstructions } from "@theokit/sdk/project";
// readProjectInstructions(cwd, { filename, scope, maxBytes }) → string (git-root-walk); writeProjectInstructions(...) atomic + path-guarded
const instructions = readProjectInstructions(process.cwd(), { filename: "THEO.md" });
```

## Subagent tool scoping — `@theokit/sdk/subagents`

```typescript
import { withSubagentToolScope, subagentToolWhitelist } from "@theokit/sdk/subagents";
// restrict a subagent to a tool whitelist (enforced, not prompt-soft)
const scoped = withSubagentToolScope(agentDef, ["read_file", "search_text"]);
```

## Path safety — `@theokit/sdk/path-safety`

```typescript
import { safePathJoin, sanitizeIdentifier, safeFilenameForId, assertNoSymlinkEscape, isForbiddenPath } from "@theokit/sdk/path-safety";
// safeFilenameForId(id, { maxLen }) → deterministic safe filename for any opaque id; safePathJoin(root, ...parts) → path that cannot escape root
const file = safePathJoin(root, safeFilenameForId(sessionId) + ".md");
```

## Persistence — `@theokit/sdk/persistence`

```typescript
import {
  appendJsonl,          // appendJsonl(path, record) → append one \n-terminated JSON line (mkdirs parent; crash-safe per-line flush)
  readJsonlIds,         // readJsonlIds(path, keyFn) → Set<string> of done keys (tolerates a trailing partial line) — resume
  loadJsonl,            // loadJsonl(path, { map? }) → rows (throws JsonlParseError with line number); also at @theokit/sdk/eval
  replaceFileAtomic,    // replaceFileAtomic(path, content) → Promise<void> (temp + fsync + 0o600 + rename; never torn)
  atomicWriteText, atomicWriteJson,
  withFileLock,         // withFileLock(path, fn) → run an async critical section under a cross-process lock
  openSqliteResilient, applyWalWithFallback, isCorruptionError, // resilient SQLite bootstrap
} from "@theokit/sdk/persistence";

// Durable, resumable batch run:
appendJsonl("out/preds.jsonl", { id, patch });
const done = readJsonlIds("out/preds.jsonl", (r) => (r.patch ? String(r.id) : undefined));
```

## Eval & sandbox — `@theokit/sdk/eval`, `@theokit/sdk/sandbox`

```typescript
import { Eval, Scorers, loadJsonl, captureArtifact } from "@theokit/sdk/eval";
import { LocalSandbox, provisionRepo, RepoProvisionError } from "@theokit/sdk/sandbox";
// Scorers.verifyGate({ sandbox, repoDir, failToPass, passToPass, command }) → exit-code scorer
// provisionRepo(sandbox, { repoUrl, ref, instanceId }) → { repoDir } (clone+checkout via SandboxBackend)
const ev = Eval.create({ name: "swe", dataset, scorers: [Scorers.verifyGate({ sandbox: new LocalSandbox(), repoDir, failToPass, passToPass, command })], agent });
```

## Workflow, task store, cron, subscription, A2A, client

```typescript
import { Workflow, WorkflowBuilder, agentStep, fn } from "@theokit/sdk/workflow"; // typed multi-step workflows
import { InMemoryTaskStore, JsonFileTaskStore, getTaskStoreFor } from "@theokit/sdk/task-store"; // durable task persistence
import { Cron } from "@theokit/sdk/cron"; // Cron.create(...) scheduled agent runs
import { defineSubscription, subscribe, tracked } from "@theokit/sdk/subscription"; // streaming subscriptions + resume tokens
import { AgentMailbox, MessageBus, defineSubAgent } from "@theokit/sdk/a2a"; // agent-to-agent messaging
import { TheoKitClient } from "@theokit/sdk/client"; // typed client for the cloud runtime
```

## Server-side (cloud runtime) — `@theokit/sdk/server/*`

For building the server that backs the cloud runtime (OAuth callbacks + a canonical error envelope across HTTP surfaces).

```typescript
import { defineAuth, validateReturnTo } from "@theokit/sdk/server/auth";
// defineAuth({ providers, ... }) → auth handler; validateReturnTo(url, allowlist) → safe redirect target
// + typed errors: AuthCallbackError, AuthCancelledError, AuthConfigError, AuthProviderNotFoundError, AuthSecretTooShortError

import { toEnvelope, fromEnvelope } from "@theokit/sdk/server/errors-envelope";
// toEnvelope(err) → a canonical wire error envelope; fromEnvelope(envelope) → a typed error (cross-surface error contract)
```

---

## Code-assistant toolbox — `@theokit/sdk-tools`

```typescript
import {
  // File / shell / search tools (factories returning CustomTool):
  createReadFileTool, createWriteFileTool, createEditFileTool, createApplyPatchTool,
  createListDirTool, createGlobTool, createSearchTextTool, createGitDiffTool,
  createShellTool, createRunVitestTool, createTodolistTool, createPlanModeTool, createQuestionTool,
  // Web fetch + search (SSRF-guarded):
  createWebFetchTool, createWebSearchTool, createBraveWebSearchAdapter,
  // SSRF guard primitives:
  isBlockedIp,          // isBlockedIp(ip) → boolean (private/loopback/link-local/metadata)
  resolveAndScreen,     // resolveAndScreen(host) → screened addresses (throws SsrfBlockedError)
  screenedFetch,        // screenedFetch(url, opts) → Response (redirect:'manual' + re-screen each hop)
  // Catastrophic shell screen:
  catastrophicShellReason, // catastrophicShellReason(cmd) → reason | null (rm -rf /, curl|sh, force-push, exfil, ...)
  denyCatastrophicCommands, commandDenialReason, isCommandAllowed,
  // Context builders:
  buildRepoMap,         // buildRepoMap(cwd, { budget, ignore }) → directory map string (orient the LLM in one call)
  buildEnvContext,      // buildEnvContext(cwd) → env/git orientation block
  // ACI / tool-result ergonomics:
  withDescription, renderToolList, withToolResultGuidance, injectGuidance, withDefaultGuidance,
  todoItemsToPlanNodes, // todoItemsToPlanNodes(items) → PlanNode[]
  createSessionArtifactStore, // durable plan/artifact persistence
  // Output formatting + truncation:
  formatDiff, formatCode, formatError, formatFileList, truncateOutput,
} from "@theokit/sdk-tools";

const map = buildRepoMap(process.cwd(), { budget: 4000 }); // codebase orientation in one call
const reason = catastrophicShellReason("rm -rf /"); // → a non-null deny reason
```

---

## Out-of-repo capabilities

These GAP_AUDIT primitives target packages that live in **sibling repos**, not in `theokit-sdk`. Look for them there:

| Capability | Target package | Where |
|---|---|---|
| `AgentToolRenderer`, `ToolCallCard`, `AgentStream`, `useStickToBottom`, tool-result→props adapters, `TokenUsageChart` | `@theokit/ui` | `theokit-tools/theo-ui/` (React presentation library) |
| `liveText`/`error` on the stream hook, `foldAgentToolCards`/`useAgentToolCards` | `theokit/client` | `theokit-tools/theokit/` (the `theokit` framework, `theokit/client` subpath) |
| `defineHealthRoute`/`defineReadyRoute`, 404 typed exceptions in `defineRoute`, programmatic boot (`theokit/boot`) | `theokit` (packages/theo) | `theokit-tools/theokit/` |
| `createRepository(db, table)` (sync-aware Drizzle CRUD) | `@theokit/orm` | separate package (not yet installed by default) |
| `createCategorizedMemory({ categories })` (typed markdown memory) | `@theokit/sdk-memory` | `packages/sdk-memory/` |
| Honest-null cost aggregation | `@theokit/sdk-budget` | `packages/sdk-budget/` |
| `catastrophicShellReason` + `denyCatastrophicCommands` composition in the permission path | `@theokit/agents` | sibling repo (the mechanism is public in `@theokit/sdk-tools`) |

---

## Behavior wired, but not a standalone export

A few GAP_AUDIT items are runtime behaviors the harness performs internally — there is no single exported symbol to import. The relevant public pieces are linked:

- **Enforced iteration cap.** The cap is enforced by `createCounterBudgetTracker({ maxIterations })` (above) + `RunResult.stoppedAtIterationLimit`; there is no separate `nextIteration` export to call.
- **Continuation over the internal step cap.** A stateless continuation loop is the consumer's outer loop; the harness provides `buildReplayHistory` (above) to rebuild the transcript per round. (A first-party `agent.runToCompletion` continuation driver is not shipped as a public method.)
- **Bounded reflection ladder.** This is a consumer-side policy; the harness exposes the stream/hook surface but not a packaged reflection ladder.

---

## See also

- [`docs.md`](../docs.md) — the canonical, exhaustive public API contract.
- [`packages/sdk/README.md`](../packages/sdk/README.md) — `@theokit/sdk` front door.
- [`packages/sdk-tools/README.md`](../packages/sdk-tools/README.md) — `@theokit/sdk-tools` front door.
