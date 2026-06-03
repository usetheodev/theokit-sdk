# Plan: ACP Server Adapter — `@theokit/acp`

> **Version 1.1** — Ship `@theokit/acp` workspace package that exposes any `@theokit/sdk` `SDKAgent` as an Agent Client Protocol (ACP) server over stdio JSON-RPC, using the official `@agentclientprotocol/sdk@^0.22`. Adds a `theokit acp` CLI verb and a publishable `agent.json` registry manifest so Zed/Cursor/Claude Desktop users can drive our SDK as a coding agent without writing any glue code. Outcome: closes one of two SDK-level gaps vs OpenClaw (server-only first; ACP client comes in a follow-up plan).
>
> **v1.1 changelog:** Edge case review absorbed 6 MUST FIX items (EC-1 cleanup-on-shutdown, EC-2 permission-timeout, EC-3 CloudAgent-fork-rejection, EC-4 CJS-module-interop, EC-5 cwd-absolute-resolve, EC-6 storage-hint-on-load-failure). RED test count grew from ~80 to ~95. Coverage matrix grew from 23 to 29 items.

## Context

The competitive analysis vs OpenClaw and Hermes Agent (chat 2026-05-26) identified **ACP** as one of two material SDK-level gaps:

- **OpenClaw** ships ACP both as server (`src/acp/server.ts` — 2171 LoC translator + event-mapper) and client (`src/acp/client.ts`). Registered in their plugin system.
- **Hermes Agent** ships ACP server only (`acp_adapter/server.py` — 1714 LoC `HermesACPAgent extends acp.Agent`) plus a published `acp_registry/agent.json` for the Zed ACP marketplace.
- **We** have zero ACP integration. Our `Agent.create()` / `agent.send()` library is invisible to Zed, Cursor, Claude Desktop, and any other ACP-enabled host.

The `@agentclientprotocol/sdk@0.22.1` is published by Zed Industries (Apache-2.0, zero runtime deps, weekly release cadence). It defines a JSON-RPC stdio protocol with `initialize`, `authenticate`, `new_session`, `load_session`, `resume_session`, `fork_session`, `list_sessions`, `prompt`, `cancel`, and a streaming `session/update` notification with content blocks (`text`, `image`, `tool_call`, `tool_call_update`).

Server-first is recommended because (a) it makes our SDK immediately reachable from existing Zed/Cursor user bases, (b) translation layer is one-way (ACP `prompt` → our `Agent.send`; our `SDKMessage` → ACP `SessionUpdate`), and (c) the client direction can later compose with our existing `Handoff` primitive (D214-D229) rather than reinvent transport.

Evidence:
- OpenClaw analysis: `referencia/openclaw/src/acp/` (10+ source files, 2171-line translator).
- Hermes analysis: `referencia/hermes-agent/acp_adapter/server.py` + `acp_registry/agent.json` (single-file registry manifest, `distribution.type: "command"`).
- npm metadata: `npm view @agentclientprotocol/sdk@0.22.1` confirms Apache-2.0, zero deps, recent release.
- Our existing patterns to mirror: `@theokit/gateway-{telegram,discord,slack,teams,whatsapp,email}` (workspace package with peer deps + dual ESM/CJS dist via tsup), `@theokit/cli` subcommand structure (`packages/cli/src/main.ts`).

## Objective

Ship a production-ready ACP server adapter that lets a real Zed/Cursor user point their editor at `theokit acp` and drive an `@theokit/sdk` agent end-to-end.

Specific measurable goals:
1. New `@theokit/acp@0.1.0` workspace package published, peer-depped on `@theokit/sdk` + `@agentclientprotocol/sdk`.
2. Public API surface: `serveAcp({ agent, info?, capabilities? })` + `AcpServerOptions` type.
3. New CLI verb: `theokit acp [--entry <path>]` launches stdio server pointing at an entry file's default-exported agent.
4. `agent.json` ACP registry manifest published in `packages/acp/registry/` and listed in `theo-opendocs` cookbook.
5. End-to-end Zed dogfood: open Zed → External Agents → add `@theokit/sdk` → send a prompt → receive streamed reply with at least one tool call.
6. SDK-level test coverage ≥90% for translator + lifecycle handlers (excluding integration tests requiring Zed).
7. Zero regressions in existing SDK / CLI / gateway packages.

## ADRs

| ID | Decision | Rationale | Consequences |
|---|---|---|---|
| D349 | `@theokit/acp` ships as a **separate workspace package**, NOT folded into `@theokit/sdk` | Same precedent as `@theokit/gateway-*` and `@theokit/memory-*`: protocol adapters live outside core SDK so consumers who never need ACP don't pay bundle cost. Also lets the ACP SDK be optional-peer for the user. | Adds one more npm artifact to maintain. Peer dep on `@theokit/sdk` workspace:^ + `@agentclientprotocol/sdk@^0.22`. Versions pre-1.0 (D181 pattern) until the protocol API stabilizes upstream. |
| D350 | Server-only in v1; ACP **client** (calling external ACP agents) deferred to v0.2 | Server is the high-leverage path (distribution to Zed/Cursor users). Client adds subprocess lifecycle + auth flow complexity and overlaps with `Handoff` (D214-D229). Sequencing avoids landing a half-baked client. | `theokit acp` only **serves**; calling Zed's Claude Code from inside our agent requires v0.2. Documented in README. |
| D351 | `serveAcp({ agent: SDKAgent })` accepts a **factory function** for per-session agents, NOT a single shared agent | ACP `new_session` spec implies one agent state per session. A single shared `SDKAgent` would leak conversation history across sessions. Factory shape: `agent: (sessionId) => Promise<SDKAgent>`. Single-agent callers wrap with `() => existingAgent` if intentional. | Forces callers to think about per-session isolation. Adds one indirection. Backward-compatible — single agent is still expressible. |
| D352 | ACP session lifecycle maps **1:1 to our `agentId`**: `new_session` → `Agent.create`; `load_session` → `Agent.resume`; `cancel` → `agent.dispose()` lifecycle controller; `fork_session` → `agent.fork()` | We already have all four primitives shipped (ADRs D304-D325 for storage, D110-D114 for fork, D319 for lifecycle abort). Reusing them avoids parallel state machines. | If our agent primitives change shape, the translator may need to follow. Documented as an integration point. |
| D353 | `prompt` translation uses an **AsyncGenerator pipeline**: `agent.send(text).stream()` → `SDKMessage` → ACP `SessionUpdate` notifications | Aligns with our existing AsyncGenerator-based streaming (Run.stream() returns `AsyncGenerator<SDKMessage>`). One-to-many mapping is natural: SDK emits one `SDKAssistantMessage` per turn; translator may emit multiple ACP `agent_message_chunk` updates. | Translator is the load-bearing module; ~300-500 LoC expected (vs OpenClaw's 2171 because we skip gateway plumbing). Discriminated union switch on `SDKMessage.type` — exhaustive check required. |
| D354 | `cancel` notification triggers the **lifecycle AbortController** already wired in `LocalAgent` (D319) | Reuse over parallel cancellation mechanism. No code change on SDK side. | Existing semantics: aborted runs surface as `AgentRunError({ code: "aborted" })` — translator maps that to ACP `stop_reason: "cancelled"`. |
| D355 | Tool **permission requests** translate `pre_tool_call` veto hook → ACP `tool_call_permission_request` notification → roundtrip back to veto/allow | Tool approval is a first-class ACP concept and our SDK's existing `pre_tool_call` veto is the closest primitive. Translator awaits user response before allowing the tool to proceed; timeout → auto-deny. | Requires installing a synthetic plugin from the translator that intercepts tool calls. Documented invariant: user MUST be present (no headless permission grant). Add `permissionDefault: "auto"|"ask"|"deny"` option to disable interactive mode for CI. |
| D356 | **No global state in `@theokit/acp`**: every `serveAcp()` call gets its own session store (Map), abort controller, and stdio binding | Multi-process safety (some hosts spawn one ACP server per workspace). Avoids cross-instance leakage if a consumer wraps `serveAcp` differently. | Session store is in-memory only by default. JSON-file persistence is a v0.2 follow-up (mirrors D235 for workflows). |
| D357 | `theokit acp` CLI subcommand uses the same **entry resolver** as `theokit dev` (`packages/cli/src/dev/entry-resolver.ts`) | Consistency — `dev` already resolves `src/index.ts` or `package.main` and dynamically imports the default export. ACP just hooks the result into `serveAcp` instead of `tsx --watch`. | Entry file MUST export a default `SDKAgent`-factory or `SDKAgent` instance. CLI wraps single-instance default exports into a factory automatically (D351 backward-compat). |
| D358 | `agent.json` registry manifest lives at `packages/acp/registry/agent.json` AND is mirrored to `theo-opendocs/content/theokit-sdk/concepts/acp-registry.mdx` | Discoverable by Zed/Cursor users via the ACP marketplace AND by docs readers searching for "ACP". `distribution.type: "npm"` with `command: ["npx", "theokit-acp"]`. | Bin alias `theokit-acp` shipped from `@theokit/acp` package.json (so `npx theokit-acp` works without installing CLI). |
| D359 | Logging routes to **stderr only**; stdio is reserved for JSON-RPC frame traffic | Per ACP spec — stdout is the protocol channel. OpenClaw uses `routeLogsToStderr()` for the same reason. Any `console.log` in production code path is a protocol-corrupting bug. | New CI lint rule scans `packages/acp/src/**` for `console.log` (warn → error). Translator uses an injected `log(msg: string)` callback defaulting to `process.stderr.write`. |
| D360 | Prompt size cap = **2 MiB** (matches OpenClaw `MAX_PROMPT_BYTES`) | DoS defense — unbounded prompts cause memory exhaustion (CWE-400). Same value as the upstream OpenClaw battle-tested cap. | Translator rejects oversized prompts with ACP `error: { code: "invalid_request", message: "prompt exceeds 2 MiB" }`. Configurable via `serveAcp({ maxPromptBytes })`. |

## Dependency Graph

```
Phase 0 (Inventory)
   │
   ▼
Phase 1 (Package skeleton)
   │
   ▼
Phase 2 (Session lifecycle: initialize/new_session/load_session/cancel)
   │
   ▼
Phase 3 (Translator: prompt → stream → SessionUpdate) ─┐
                                                       │
                                                       ▼
                                                  Phase 4 (Tool permission flow)
                                                       │
                                                       ▼
Phase 5 (CLI verb `theokit acp`) ──────────────────────▶ Phase 6 (Registry manifest + docs)
   │                                                       │
   └───────────────┬───────────────────────────────────────┘
                   ▼
            Phase 7 (Dogfood QA — Zed live)
```

Phases 1-4 are sequential blockers. Phase 5 + 6 can run in parallel after Phase 4 lands. Phase 7 is the final gate.

---

## Phase 0: Inventory and contract pin

**Objective:** Lock the upstream ACP SDK version, audit the surface we'll consume, and ensure we have a reproducible local Zed environment for Phase 7 dogfood.

### T0.1 — Pin `@agentclientprotocol/sdk` version + audit surface

#### Objective
Lock the upstream protocol SDK to a specific version, document which exported types we will consume, and verify our Node 22.12+ engine constraint is satisfied.

#### Evidence
- `npm view @agentclientprotocol/sdk@0.22.1`: Apache-2.0, zero deps, 1.4 MB unpacked, published with provenance + signature.
- Upstream changelog (https://github.com/agentclientprotocol/typescript-sdk/blob/main/CHANGELOG.md) shows weekly releases; pinning prevents drift mid-implementation.

#### Files to edit
```
packages/acp/package.json (NEW) — peer dep `@agentclientprotocol/sdk@~0.22.1`
.claude/knowledge-base/reference/acp-sdk-surface.md (NEW) — list every type/class we consume
.claude/knowledge-base/adrs/D349-acp-workspace-package.md (NEW)
.claude/knowledge-base/adrs/D350-acp-server-only-v1.md (NEW)
.claude/knowledge-base/adrs/D351-acp-agent-factory.md (NEW)
.claude/knowledge-base/adrs/D352-acp-session-maps-to-agent-id.md (NEW)
.claude/knowledge-base/adrs/D353-acp-translator-async-generator.md (NEW)
.claude/knowledge-base/adrs/D354-acp-cancel-via-lifecycle-controller.md (NEW)
.claude/knowledge-base/adrs/D355-acp-tool-permission-via-pre-tool-call.md (NEW)
.claude/knowledge-base/adrs/D356-acp-no-global-state.md (NEW)
.claude/knowledge-base/adrs/D357-acp-cli-entry-resolver-reuse.md (NEW)
.claude/knowledge-base/adrs/D358-acp-registry-manifest-location.md (NEW)
.claude/knowledge-base/adrs/D359-acp-stderr-only-logging.md (NEW)
.claude/knowledge-base/adrs/D360-acp-prompt-size-cap.md (NEW)
```

#### Deep file dependency analysis
- All files NEW. No existing files modified in this task.

#### Deep Dives
**Surface to document (`acp-sdk-surface.md`):**
- `AgentSideConnection` — main server class (constructor takes `Readable`, `Writable`, agent impl).
- `ndJsonStream` — newline-delimited JSON framing helper.
- `Agent` (interface) — methods we MUST implement: `initialize`, `newSession`, `prompt`, `cancel`. SHOULD implement: `loadSession`, `resumeSession`, `forkSession`, `listSessions`, `authenticate`. We can stub `cancel` (no-op) but `prompt` is mandatory.
- `InitializeResponse`, `NewSessionResponse`, `PromptResponse`, `LoadSessionResponse`, `ForkSessionResponse`, `ResumeSessionResponse`, `ListSessionsResponse`.
- `SessionUpdate` — discriminated union of `agent_message_chunk` | `tool_call` | `tool_call_update` | `available_commands_update` | `model_set` | `mode_set` | `current_mode_update` | `usage_update`.
- `ContentBlock` — discriminated union (`text` | `image` | `audio` | `resource` | `resource_link` | `embedded_resource`).
- `ToolCallContent`, `ToolCallLocation`, `ToolKind` — for translator's tool flow.
- `PromptCapabilities`, `SessionCapabilities`, `AgentCapabilities` — capability advertisement.

**Invariants captured here for downstream tasks:**
1. The upstream SDK uses **camelCase** TypeScript types but the wire format is **snake_case** JSON. The SDK handles conversion; we MUST NOT manually JSON-serialize.
2. `AgentSideConnection` takes a generator function for the `Agent` impl: `(connection: ClientSideConnection) => Agent`. The `connection` is what we use to push `sessionUpdate` notifications.
3. `prompt` MUST return a `PromptResponse` with `stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"`.

#### Tasks
1. Run `pnpm view @agentclientprotocol/sdk@0.22.1` to confirm provenance + signature.
2. Read the upstream SDK README + the unpacked tarball's `dist/index.d.ts` to enumerate the public surface.
3. Write `acp-sdk-surface.md` with every type/class we will consume, marked `[REQUIRED]` (mandatory `Agent` methods) vs `[OPTIONAL]` (capabilities we may add later).
4. Verify upstream supports Node 22 (check `engines` in their `package.json`).
5. Draft all 12 ADR stubs (D349-D360) with the rationale text from this plan's ADR table.
6. Manually install Zed locally and confirm "External Agents" UI surface exists (one-time human verification — record screenshot in `.claude/knowledge-base/reviews/acp-zed-baseline.png`).

#### TDD
This task is documentation + pinning only — no runtime code yet. No automated tests.

VERIFY:
- `npm view @agentclientprotocol/sdk@0.22.1 dist.integrity` matches the hash recorded in the inventory doc.
- `acp-sdk-surface.md` enumerates ≥10 type/class names.
- All 12 ADR files exist under `.claude/knowledge-base/adrs/`.

#### Acceptance Criteria
- [ ] `acp-sdk-surface.md` lists every consumed type with `[REQUIRED]`/`[OPTIONAL]` marker.
- [ ] All 12 ADR files (D349-D360) created with full rationale + consequences sections.
- [ ] Upstream SDK Node engine check documented (engines.node >= 18 typically — we're 22).
- [ ] Zed baseline screenshot exists.

#### DoD
- [ ] All tasks completed.
- [ ] Inventory document committed.
- [ ] ADRs committed.
- [ ] No code changes yet.

---

## Phase 1: Package skeleton

**Objective:** Create the `@theokit/acp` workspace package with the dual ESM/CJS build wired up, mirroring the gateway-* template, and add it to the monorepo.

### T1.1 — Workspace package boilerplate

#### Objective
Create the package directory, `package.json`, `tsup.config.ts`, `tsconfig.json`, vitest config, and barrel `src/index.ts` that re-exports the public API (`serveAcp` placeholder + `AcpServerOptions` type).

#### Evidence
- Every existing workspace package (`gateway-*`, `memory-*`, `skills-google-workspace`) follows the same template. Diverging here would create friction for maintainers.
- Workspace member glob in `pnpm-workspace.yaml` already includes `packages/*` — adding `packages/acp/` requires zero workspace-level config changes.

#### Files to edit
```
packages/acp/package.json (NEW) — name "@theokit/acp", version "0.1.0", peer deps SDK + ACP SDK
packages/acp/tsup.config.ts (NEW) — dual ESM/CJS, sourcemap, treeshake, external SDK + ACP SDK
packages/acp/tsconfig.json (NEW) — extends ../tsconfig.base.json
packages/acp/vitest.config.ts (NEW) — node env, default 10s timeout
packages/acp/src/index.ts (NEW) — re-exports serveAcp + types
packages/acp/src/types.ts (NEW) — public type definitions (AcpServerOptions, etc.)
packages/acp/README.md (NEW) — usage example pointing to docs
packages/acp/CHANGELOG.md (NEW) — initial 0.1.0 entry
packages/acp/LICENSE (NEW) — Apache-2.0 (symlink or copy from root)
pnpm-workspace.yaml (verify) — confirm `packages/*` glob picks up packages/acp/
.changeset/acp-initial-release.md (NEW) — minor bump for first release
```

#### Deep file dependency analysis
- `packages/acp/package.json` is NEW. Downstream effect: when `pnpm install` runs at root, the workspace will pull in `@agentclientprotocol/sdk` as a peer + dev dependency.
- `pnpm-workspace.yaml` is unchanged but must be re-verified — if any future glob exclusion was added (`!packages/acp`), it would silently skip the new package.
- `packages/sdk/package.json` is **not modified** — `@theokit/acp` is a peer dependent of `@theokit/sdk`, not the other way around. SDK consumers who don't need ACP don't see this package.

#### Deep Dives
**`package.json` shape (matches gateway-slack pattern, ADRs D170-D181):**
```jsonc
{
  "name": "@theokit/acp",
  "version": "0.1.0",
  "description": "Agent Client Protocol (ACP) server adapter for @theokit/sdk. ADRs D349-D360.",
  "license": "Apache-2.0",
  "type": "module",
  "engines": { "node": ">=22.12.0" },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "bin": { "theokit-acp": "./bin/theokit-acp.mjs" },
  "files": ["dist", "bin", "registry", "README.md", "LICENSE", "CHANGELOG.md"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "peerDependencies": {
    "@theokit/sdk": "workspace:^",
    "@agentclientprotocol/sdk": "^0.22.1"
  },
  "devDependencies": {
    "@theokit/sdk": "workspace:*",
    "@agentclientprotocol/sdk": "~0.22.1",
    "tsup": "^8.5.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

**Invariants:**
- `peerDependencies` uses `^0.22.1` (allow patch + future 0.x); `devDependencies` uses `~0.22.1` (pin for testing reproducibility).
- The `bin` entry is `theokit-acp` (D358) — a thin .mjs shim that imports `serveAcp` and reads a resolved agent factory from `--entry`.
- `files` includes `bin/` and `registry/` so npm publish ships the agent.json + bin shim.

#### Tasks
1. Create the directory `packages/acp/` and all NEW files above.
2. Configure `tsup.config.ts` identical to `packages/gateway-slack/tsup.config.ts` (dual format, externals `@theokit/sdk` + `@agentclientprotocol/sdk`).
3. Stub `src/index.ts`: `export { serveAcp } from "./serve.js"; export type { AcpServerOptions } from "./types.js";`. Mark `serveAcp` as `throw new Error("not_implemented_yet")` for now (we'll implement in Phase 2). NOTE: per `.claude/rules/no-stubs-no-mocks-no-wired.md`, this placeholder MUST be removed before merging Phase 2. Documented as a tracking checkbox in T2's DoD.
4. Stub `src/types.ts` with the `AcpServerOptions` shape (8 fields: `agent`, `info`, `capabilities`, `permissionDefault`, `maxPromptBytes`, `log`, `stdin`, `stdout`).
5. Run `pnpm install` at root — verify `pnpm-workspace.yaml` picks up the new package.
6. Run `pnpm --filter @theokit/acp build` — verify tsup produces both `dist/index.js` (ESM) and `dist/index.cjs` (CJS) with `.d.ts` + `.d.cts`.
7. Run `pnpm --filter @theokit/acp typecheck` — verify TypeScript compiles cleanly.
8. Write `CHANGELOG.md` initial entry: `## 0.1.0 — Initial release: ACP server adapter`.

#### TDD
```
RED:     skeleton.test.ts — asserts `@theokit/acp` package is importable and exports `serveAcp` (function) + `AcpServerOptions` (type) — MUST fail before T1.1 since the package doesn't exist.
GREEN:   Create the package files.
REFACTOR: None expected.
VERIFY:  pnpm --filter @theokit/acp test
```

#### Acceptance Criteria
- [ ] `pnpm install` picks up `@theokit/acp` and resolves peer deps.
- [ ] `pnpm --filter @theokit/acp build` produces dual-format `dist/`.
- [ ] `pnpm --filter @theokit/acp typecheck` passes with strict TypeScript.
- [ ] `pnpm --filter @theokit/acp test` runs the skeleton test (passes).
- [ ] `serveAcp` is a placeholder that throws — but is exported and typed correctly.
- [ ] No regressions: full `pnpm -w run validate` still green.

#### DoD
- [ ] All tasks completed and validated.
- [ ] Skeleton test passing.
- [ ] No biome / publint / attw warnings on the new package.
- [ ] `[ ] placeholder removal` tracker in Phase 2 DoD.

---

## Phase 2: Session lifecycle handlers

**Objective:** Implement the four mandatory ACP lifecycle methods (`initialize`, `newSession`, `cancel`) and the two optional resumption methods (`loadSession`, `forkSession`), wiring each to our existing SDK primitives.

### T2.1 — Session store + agent factory resolver

#### Objective
Build the in-memory session store that maps ACP `sessionId` → our SDK `SDKAgent` instance. Implement the agent factory resolver per D351 (single instance OR factory function).

#### Evidence
- Per D351, ACP `new_session` requires per-session agent isolation. Without a store, the same `SDKAgent` would be reused across sessions and conversation history would leak.
- Per D356, the store is per-`serveAcp` call (instance-scoped). No globals.

#### Files to edit
```
packages/acp/src/session-store.ts (NEW) — Map-based store + create/load/delete
packages/acp/src/agent-resolver.ts (NEW) — resolves single SDKAgent vs factory
packages/acp/src/types.ts — extend with internal types (AcpSession, AgentFactory)
packages/acp/tests/session-store.test.ts (NEW)
packages/acp/tests/agent-resolver.test.ts (NEW)
```

#### Deep file dependency analysis
- `session-store.ts` is NEW. Pure in-memory data structure — no FS or DB. Downstream: `serve.ts` and lifecycle handler files import the store.
- `agent-resolver.ts` is NEW. Imports `SDKAgent` type from `@theokit/sdk`. Downstream: lifecycle handlers call `resolveAgent(factory, sessionId)`.
- `types.ts` was created in Phase 1 as a stub; extend with `AcpSession` (sessionId, agentId, agent, createdAt, lastUsedAt, abortController) and `AgentFactory = (sessionId: string) => Promise<SDKAgent>`.

#### Deep Dives
**`AcpSession` shape:**
```ts
interface AcpSession {
  readonly sessionId: string;        // ACP-generated UUID
  readonly agent: SDKAgent;           // resolved SDK agent
  readonly createdAt: number;
  lastUsedAt: number;                 // mutated on prompt
  abortController: AbortController;   // fired by ACP cancel
}
```

**`resolveAgent` algorithm:**
1. If `agentOrFactory` is a function: call `await agentOrFactory(sessionId)`; assert result has `agentId` and `send` (duck-type check).
2. Else if it has `agentId` + `send` (looks like `SDKAgent`): wrap in a memoized factory so subsequent calls return the same instance. **WARN once** to stderr that this defeats per-session isolation (D351 contract).
3. Else throw `ConfigurationError({ code: "invalid_agent" })`.

**Edge cases:**
- Factory throws → translator returns ACP `error: { code: "internal_error", message: "agent factory threw: ..." }`. Session is NOT created. `SessionStore.size()` stays unchanged.
- Factory returns a disposed agent → `agent.send()` would throw `"Agent has been disposed"`. Translator surfaces as `error: { code: "internal_error", message: "agent factory returned disposed agent" }`.
- Same `sessionId` requested twice → ACP spec says new_session generates a fresh UUID each call. We never reuse a sessionId. `SessionStore.create()` panics if duplicate (defensive — would indicate caller bug).

#### Tasks
1. Define `AcpSession` and `AgentFactory` types in `types.ts`.
2. Implement `SessionStore` class: `create()`, `get(sessionId)`, `delete(sessionId)`, `list()`, `size()`. All operations sync.
3. Implement `resolveAgentFactory(agentOrFactory)` returning a normalized `AgentFactory` function. Handles the warn-once for single-instance shape.
4. Implement `createSession(store, factory, sessionId)` async helper that calls factory, builds `AcpSession`, inserts into store.

#### TDD
```
RED:     session_store_create_returns_session — `store.create(sess)` then `store.get(sess.sessionId)` returns the same object.
RED:     session_store_delete_removes_session — `store.delete(id)` then `store.get(id)` returns undefined.
RED:     session_store_duplicate_create_throws — calling `create()` twice with same sessionId throws.
RED:     resolver_function_factory_calls_once_per_session — factory called once per sessionId.
RED:     resolver_single_instance_wraps_in_memoized_factory_and_warns — passing an SDKAgent instance returns memoized factory + emits one stderr warn.
RED:     resolver_invalid_input_throws_configuration_error — passing `{}` throws ConfigurationError.
RED:     resolver_factory_throw_propagates — factory throwing becomes a translator-visible error.
GREEN:   Implement session-store.ts and agent-resolver.ts.
REFACTOR: Extract common assertion helpers into a tests/_helpers.ts if duplication appears.
VERIFY:  pnpm --filter @theokit/acp test session-store agent-resolver
```

#### Acceptance Criteria
- [ ] `SessionStore.create/get/delete/list/size` all work as specified.
- [ ] Duplicate `create` panics (defensive).
- [ ] Factory resolver handles both shapes; emits warn for single-instance.
- [ ] Factory throw surfaces as a clean error (not unhandled rejection).
- [ ] Pass: biome complexity ≤10 per function.
- [ ] Pass: ≥90% line coverage on session-store.ts + agent-resolver.ts.
- [ ] Pass: zero biome warnings.
- [ ] Pass: file size ≤200 LoC each.

#### DoD
- [ ] All tasks completed and validated.
- [ ] All RED tests now GREEN.
- [ ] `pnpm --filter @theokit/acp test` green.
- [ ] `pnpm --filter @theokit/acp typecheck` green.

---

### T2.2 — `initialize` + `newSession` + `cancel` handlers

#### Objective
Implement the three core lifecycle handlers and wire them into an `AgentSideConnection` from `@agentclientprotocol/sdk`. After this task, the server can accept a connection, advertise capabilities, create a session, and respond to cancel — but `prompt` still throws (Phase 3).

#### Evidence
- ACP spec requires `initialize` for handshake and `cancel` for session interruption. Without these, no client can connect.
- Per D354, `cancel` reuses `LocalAgent.dispose()` lifecycle controller — no new abort mechanism needed.

#### Files to edit
```
packages/acp/src/serve.ts (NEW) — top-level `serveAcp({ agent, info?, capabilities? })` entry
packages/acp/src/lifecycle.ts (NEW) — initialize/newSession/cancel handlers
packages/acp/src/types.ts — finalize AcpServerOptions, AcpCapabilities
packages/acp/tests/lifecycle.test.ts (NEW)
packages/acp/tests/serve.test.ts (NEW)
packages/acp/src/index.ts — remove the "not_implemented_yet" placeholder
packages/acp/CHANGELOG.md — log Phase 2 progress
```

#### Deep file dependency analysis
- `serve.ts` is the orchestrator: constructs `AgentSideConnection` from `@agentclientprotocol/sdk`, instantiates `SessionStore`, wires `lifecycle.ts` handlers, and returns the `Promise<void>` that resolves on stdin close.
- `lifecycle.ts` exports three async functions: `handleInitialize(params, capabilities)`, `handleNewSession(params, store, factory)`, `handleCancel(params, store)`. Each is pure (takes deps as args; no module-level state).
- `types.ts` finalizes the `AcpServerOptions` interface — adding `permissionDefault?: "ask" | "auto" | "deny"` (default `"deny"` in v1; tool flow added in Phase 4).
- `index.ts` removes the throwing placeholder, replacing with the real `serveAcp` export.

#### Deep Dives
**`handleInitialize` algorithm:**
1. Receive `params: InitializeRequest` from upstream SDK.
2. Build `InitializeResponse`:
   - `protocolVersion`: read from `@agentclientprotocol/sdk` constants (DO NOT hardcode — the SDK exports its supported version).
   - `agentCapabilities`: merged from `defaultCapabilities` (D353 — prompt streaming yes; load_session yes; fork yes; list_sessions yes; resume_session: future) and user-provided `options.capabilities`.
   - `authMethods`: empty array in v1 (no auth — D350 leaves that for v0.2).
3. Return response.

**`handleNewSession` algorithm:**
1. Receive `params: NewSessionRequest` (contains `cwd` and `mcpServers`).
2. **EC-5 absorbed:** resolve `params.cwd` to absolute via `path.resolve(params.cwd)`. Zed/Cursor may spawn us from a different working directory; relative cwd is ambiguous. If `!existsSync(resolvedCwd)` → return `error: { code: "invalid_request", message: "cwd not found: <path>" }`.
3. Generate ACP session id via `randomUUID()`.
4. Call `factory(sessionId)` → `SDKAgent`. The factory should propagate `resolvedCwd` into its `Agent.create({ local: { cwd } })` (documented in concept page T6.1).
5. Build `AcpSession`; insert into store.
6. Return `NewSessionResponse({ sessionId, modes: undefined })`.

**`handleCancel` algorithm:**
1. Receive `params: CancelNotification` (contains `sessionId`).
2. Lookup session in store. If missing, no-op (ACP spec: cancel is idempotent — silently succeed).
3. Fire `session.abortController.abort("cancelled by ACP client")`.
4. Update `session.lastUsedAt`.
5. Return (no response — `cancel` is a notification).

**Invariants:**
- `handleInitialize` MUST NOT touch the session store. It's stateless.
- `handleNewSession` MUST validate `params.cwd` exists (defensive — agent factory will fail later if not, but failing early gives a clean error).
- `handleCancel` MUST be idempotent — calling twice on same sessionId is fine.
- `handleCancel` MUST NOT dispose the agent — only abort. The session remains in the store; subsequent prompts return early with an `error: { code: "session_cancelled" }`. (Disposal happens on stdin close, Phase 5.)

#### Tasks
1. Implement `handleInitialize` in `lifecycle.ts`. Build the capability merge logic.
2. Implement `handleNewSession`. Wire to `SessionStore.create` and `createSession` helper.
3. Implement `handleCancel`. Idempotent — no throw on unknown sessionId.
4. Implement `serveAcp({ agent, info, capabilities, log, stdin, stdout })` in `serve.ts`:
   - Resolve factory.
   - Construct `SessionStore`.
   - Build the `Agent` impl object passed to `AgentSideConnection` — methods delegate to lifecycle handlers.
   - Construct `AgentSideConnection(stdin ?? process.stdin, stdout ?? process.stdout, agentImpl)`.
   - **EC-1 absorbed:** on `stdin` `"end"` (or `"close"`), iterate `sessionStore.list()` and `await Promise.allSettled(sessions.map(s => s.agent.dispose()))` BEFORE resolving the returned promise. Without this, file locks (D61) and registry handles leak when Zed disconnects.
   - Return a promise that resolves AFTER all agent disposals settle (success or failure — disposal errors are logged but do not propagate).
5. Remove the throw-on-call placeholder in `src/index.ts`. Now `serveAcp` is a real function.
6. Add a comment-block at the top of `serve.ts` referencing D349, D351, D356.

#### TDD
```
RED:     initialize_returns_correct_protocol_version — handleInitialize response matches upstream SDK's exported protocolVersion constant.
RED:     initialize_merges_user_capabilities_over_defaults — user capabilities take precedence.
RED:     new_session_creates_agent_and_stores — factory called, session in store, sessionId returned.
RED:     new_session_factory_throw_propagates_as_error — caller sees clean error, store unchanged.
RED:     new_session_validates_cwd_exists — non-existent cwd → invalid_request error.
RED:     new_session_resolves_relative_cwd_to_absolute — EC-5: params.cwd="./project" → path.resolve applied before factory called.
RED:     new_session_unresolvable_cwd_returns_invalid_request — EC-5: cwd that doesn't exist after resolve → invalid_request with helpful message.
RED:     cancel_aborts_lifecycle_controller — `cancel(sessionId)` fires `session.abortController.abort()`.
RED:     cancel_unknown_session_id_no_op — calling cancel with random uuid returns without throwing.
RED:     cancel_twice_idempotent — calling cancel twice on same session is safe.
RED:     serve_returns_promise_resolves_on_stdin_close — `serveAcp` resolves when stdin emits "end".
RED:     serve_disposes_all_sessions_on_stdin_close — EC-1: every session in store has `agent.dispose()` called before serveAcp promise resolves; disposal errors logged not thrown.
RED:     serve_factory_rejected_at_construction_throws — passing `agent: {}` throws ConfigurationError before stdin even starts.
GREEN:   Implement lifecycle.ts + serve.ts.
REFACTOR: Extract capability-merge utility if it grows past ~30 LoC.
VERIFY:  pnpm --filter @theokit/acp test lifecycle serve
```

#### Acceptance Criteria
- [ ] All 12 RED tests now GREEN (10 original + EC-1 dispose-on-close + EC-5 cwd resolve).
- [ ] `serveAcp` placeholder removed from src/index.ts.
- [ ] `serveAcp({ agent: () => agent }).then()` returns a promise (smoke).
- [ ] Cancel is fully idempotent and never throws on unknown sessionId.
- [ ] **EC-1:** stdin close iterates all sessions, awaits `Promise.allSettled` of `dispose()` calls, only then resolves.
- [ ] **EC-5:** `params.cwd` resolved via `path.resolve` before passed to factory.
- [ ] Pass: biome complexity ≤10 per function (capability merge is the only candidate to exceed — must extract if so).
- [ ] Pass: ≥90% line coverage on lifecycle.ts + serve.ts.
- [ ] Pass: zero biome warnings.
- [ ] Pass: serve.ts ≤300 LoC, lifecycle.ts ≤250 LoC.

#### DoD
- [ ] All tasks completed and validated.
- [ ] Placeholder `throw new Error("not_implemented_yet")` is GONE.
- [ ] `pnpm --filter @theokit/acp test` green.
- [ ] `pnpm --filter @theokit/acp build` produces working dist with no warnings.
- [ ] CHANGELOG.md updated with Phase 2 progress.

---

### T2.3 — `loadSession` + `forkSession` handlers

#### Objective
Wire ACP session resumption (`load_session`, `fork_session`) to our existing SDK primitives `Agent.resume()` (D304-D325) and `agent.fork()` (D110-D114).

#### Evidence
- Per D352, ACP session IDs map 1:1 to our `agentId`. Resumption is therefore reusing `Agent.resume({ agentId })`.
- Per D352, fork maps to `agent.fork({ ... })`. Our fork returns a new agent with byte-identical system prompt (D112) + restricted tool whitelist (D111).

#### Files to edit
```
packages/acp/src/lifecycle.ts — add handleLoadSession, handleForkSession
packages/acp/src/serve.ts — wire new handlers into the Agent impl
packages/acp/tests/lifecycle.test.ts — extend with load + fork tests
```

#### Deep file dependency analysis
- `lifecycle.ts` gains two functions. Each ≤50 LoC. The file is still under the 400 LoC target.
- `serve.ts` adds two more method entries to the `agentImpl` object passed to `AgentSideConnection`. No new imports.

#### Deep Dives
**`handleLoadSession` algorithm:**
1. Receive `params: LoadSessionRequest` (contains `sessionId`, `cwd`, `mcpServers`).
2. **EC-5 absorbed:** resolve `params.cwd` to absolute via `path.resolve(params.cwd)`; reject with `invalid_request` if not existent. Same logic as `handleNewSession`.
3. Validate the session is NOT already in store (would mean duplicate-load — ACP spec is ambiguous; we reject defensively).
4. Call `Agent.resume({ agentId: params.sessionId })`. Note: ACP sessionId == our agentId here.
5. **EC-6 absorbed:** on `Agent.resume` throwing `AgentNotFoundError`, return ACP `error: { code: "invalid_session", message: "session not found — if running on serverless/multi-host infra, pass conversationStorage to Agent.create (see docs/recipes/conversation-storage-postgres.md)" }`. The actionable hint matters because the default `FileSystemConversationStorage` is FS-local and silently loses state across process restarts on serverless. Do NOT create a session.
6. On success: wrap in `AcpSession`, insert into store. Return `LoadSessionResponse({ sessionId })`.

**`handleForkSession` algorithm:**
1. Receive `params: ForkSessionRequest` (contains `sessionId`, `cwd`, `mcpServers`).
2. **EC-5 absorbed:** resolve `params.cwd` to absolute (if provided); reject with `invalid_request` if not existent. If `params.cwd` is omitted, fork inherits parent's cwd (covered by SHOULD TEST EC-12).
3. Lookup parent session. If missing → `error: { code: "invalid_session", message: "parent not loaded" }`.
4. **EC-3 absorbed:** wrap `parent.agent.fork({ toolWhitelist: undefined })` in `try/catch`. If `UnsupportedRunOperationError` is thrown (CloudAgent — D122/D169 reject fork), return ACP `error: { code: "invalid_request", message: "fork not supported on this agent runtime (CloudAgent does not implement fork)" }`. Any other throw → re-throw as internal_error.
5. Generate fresh ACP sessionId; wrap forked agent in new `AcpSession`; insert into store.
6. Return `ForkSessionResponse({ sessionId: newId })`.

**Invariants:**
- `loadSession` uses the agentId-as-sessionId convention. If a consumer wants different mapping, they pass `agent: factory(sessionId)` where factory translates sessionId → custom agentId. Documented in README.
- `forkSession` MUST inherit the parent's lifecycle abort controller (so cancelling parent cancels forks). Implementation: copy `parent.abortController.signal` into the new session's controller via `anySignal` (D324).
- `loadSession` MUST refuse to overwrite an existing in-memory session for the same sessionId (defensive).

#### Tasks
1. Implement `handleLoadSession` in `lifecycle.ts`.
2. Implement `handleForkSession` in `lifecycle.ts`.
3. Wire both into `serve.ts`'s `agentImpl` object.
4. Update README.md with the "sessionId == agentId" convention and the override pattern.

#### TDD
```
RED:     load_session_resumes_existing_agent — Agent.resume called with right agentId, session inserted.
RED:     load_session_unknown_agent_returns_invalid_session_with_storage_hint — EC-6: error.message includes "if running on serverless... see docs/recipes/conversation-storage-postgres.md".
RED:     load_session_duplicate_rejects — loading same sessionId twice is rejected.
RED:     load_session_resolves_relative_cwd — EC-5: relative cwd resolved before Agent.resume.
RED:     fork_session_returns_new_session_id — new UUID generated, parent intact.
RED:     fork_session_unknown_parent_returns_invalid_session — error response.
RED:     fork_session_abort_inherits_from_parent — aborting parent fires child abort signal.
RED:     fork_session_cloud_agent_returns_invalid_request — EC-3: CloudAgent.fork throws UnsupportedRunOperationError → wrapped as invalid_request, not internal_error.
RED:     fork_session_resolves_relative_cwd_when_provided — EC-5: explicit cwd resolved.
RED:     fork_session_omitted_cwd_inherits_parent_cwd — SHOULD TEST EC-12 absorbed.
GREEN:   Implement load + fork handlers.
REFACTOR: None expected.
VERIFY:  pnpm --filter @theokit/acp test lifecycle
```

#### Acceptance Criteria
- [ ] All 10 RED tests now GREEN (6 original + EC-3 cloud fork + EC-5 cwd resolve × 2 + EC-6 storage hint + EC-12 cwd inheritance).
- [ ] `loadSession` uses `Agent.resume` from `@theokit/sdk`.
- [ ] `forkSession` uses `agent.fork()` from `@theokit/sdk` with try/catch around `UnsupportedRunOperationError`.
- [ ] Forked session's abort signal cascades from parent.
- [ ] **EC-3:** CloudAgent fork attempt surfaces as ACP `invalid_request`, NOT `internal_error`.
- [ ] **EC-5:** cwd resolved via path.resolve before any agent operation.
- [ ] **EC-6:** `load_session` not-found error includes recipe hint.
- [ ] Pass: complexity ≤10 per function.
- [ ] Pass: ≥90% coverage on the new handlers.
- [ ] Pass: zero biome warnings.

#### DoD
- [ ] All tasks completed and validated.
- [ ] README documents the sessionId == agentId mapping + override pattern.
- [ ] `pnpm --filter @theokit/acp test` green.

---

## Phase 3: Translator — prompt → stream → SessionUpdate

**Objective:** Implement the central translation pipeline: ACP `prompt` request → our `agent.send()` → consume `Run.stream()` → emit ACP `sessionUpdate` notifications.

### T3.1 — Prompt content extraction + size cap

#### Objective
Extract the user-text portion of an ACP `PromptRequest` (which is a mixed-content array: text, image, resource), and enforce the 2 MiB cap (D360).

#### Evidence
- ACP prompts can carry text + images + embedded resources. Our SDK's `agent.send(message)` accepts `string | SDKUserMessage` where the latter has `attachments`. We extract text for now; attachments are deferred to Phase 3.3.
- D360: 2 MiB cap is the same battle-tested value OpenClaw uses.

#### Files to edit
```
packages/acp/src/prompt-extract.ts (NEW) — extract text + attachments from ContentBlock[]
packages/acp/src/types.ts — define PromptExtractionResult internal type
packages/acp/tests/prompt-extract.test.ts (NEW)
```

#### Deep file dependency analysis
- `prompt-extract.ts` is a pure function (no IO). NEW file. Used by `translator.ts` (T3.2). Standalone testable.
- `types.ts` adds `PromptExtractionResult = { text: string; attachments: Attachment[] }` for cross-module type sharing.

#### Deep Dives
**Algorithm:**
1. Iterate `ContentBlock[]`.
2. `text` block → append `block.text` to running string buffer (with `\n` separator).
3. `image` / `audio` / `resource` / `resource_link` / `embedded_resource` → collect in attachments array.
4. Track total decoded size (text bytes + base64-decoded media bytes).
5. If total > maxPromptBytes → throw `PromptTooLargeError({ size, limit })`.
6. Return `{ text, attachments }`.

**Edge cases:**
- Empty `ContentBlock[]` → return `{ text: "", attachments: [] }`. Translator decides whether to reject as `invalid_request` (we will).
- Text block with UTF-16 surrogate pair → counted as 4 bytes (correct UTF-8 byte length, not JS string length).
- Embedded resource with `audio/ogg` (Whisper input) → preserved as Buffer with mime type intact for v0.2 (where we'll wire it to the SDK's voice surface — outside v1 scope).

#### Tasks
1. Implement `extractPrompt(blocks, maxBytes)` function.
2. Build the `PromptTooLargeError` class (extends `Error`, has `size` and `limit` fields).
3. Handle each ContentBlock variant exhaustively (use `as never` exhaustive check).

#### TDD
```
RED:     extract_single_text_block — returns { text, attachments: [] }.
RED:     extract_multi_text_concat_with_newline — two text blocks joined by "\n".
RED:     extract_image_block_collected_as_attachment — base64 image preserved.
RED:     extract_empty_returns_empty — empty array → empty result.
RED:     extract_oversized_throws_prompt_too_large — 2.1 MiB throws.
RED:     extract_utf16_surrogate_counts_utf8_bytes — emoji counted correctly.
RED:     extract_unknown_block_type_throws — defensive (never-case).
GREEN:   Implement prompt-extract.ts.
REFACTOR: None expected.
VERIFY:  pnpm --filter @theokit/acp test prompt-extract
```

#### Acceptance Criteria
- [ ] All 7 RED tests now GREEN.
- [ ] Exhaustive ContentBlock switch with `never` check.
- [ ] Size cap correctly counts UTF-8 bytes, not JS string length.
- [ ] Pass: complexity ≤10.
- [ ] Pass: ≥90% coverage.
- [ ] Pass: zero biome warnings.
- [ ] Pass: file ≤200 LoC.

#### DoD
- [ ] All tasks completed and validated.
- [ ] `PromptTooLargeError` exported from `src/types.ts` (consumers may want to catch).
- [ ] `pnpm --filter @theokit/acp test` green.

---

### T3.2 — Stream translator (SDKMessage → SessionUpdate)

#### Objective
The core of the package: translate every `SDKMessage` variant emitted by `Run.stream()` into the appropriate ACP `SessionUpdate` notification, push via the `AgentSideConnection`.

#### Evidence
- Our `Run.stream()` returns `AsyncGenerator<SDKMessage>` (line 167 of `packages/sdk/src/types/run.ts`).
- `SDKMessage` is a 9-variant discriminated union (lines 160-169 of `packages/sdk/src/types/messages.ts`).
- ACP `SessionUpdate` is a discriminated union: `agent_message_chunk` | `tool_call` | `tool_call_update` | `available_commands_update` | `model_set` | `mode_set` | `current_mode_update` | `usage_update`.

#### Files to edit
```
packages/acp/src/translator.ts (NEW) — the stream pipeline
packages/acp/src/translator-blocks.ts (NEW) — ContentBlock builders (text, image)
packages/acp/tests/translator.test.ts (NEW)
packages/acp/tests/translator-blocks.test.ts (NEW)
```

#### Deep file dependency analysis
- `translator.ts` consumes `AsyncGenerator<SDKMessage>` and the ACP `ClientSideConnection` (for pushing notifications). NEW file. ~250-350 LoC.
- `translator-blocks.ts` holds small builders that convert SDK content (TextBlock, ToolUseBlock) → ACP ContentBlock. NEW. Separated for testability.
- No SDK files modified.

#### Deep Dives
**`translateStream(messages, conn, sessionId, controller)` algorithm:**
```
for await message of messages:
  if controller.signal.aborted: break
  switch (message.type):
    case "system":     // init event; no ACP equivalent — skip
      continue
    case "user":       // echo; no ACP equivalent — skip
      continue
    case "assistant":  // text or tool use
      for content in message.message.content:
        if content.type === "text":
          await conn.sessionUpdate(sessionId, { kind: "agent_message_chunk", content: textBlock(content.text) })
        else if content.type === "tool_use":
          await conn.sessionUpdate(sessionId, {
            kind: "tool_call",
            toolCallId: content.id,
            title: content.name,
            kind_: toolKind(content.name),  // map known tools → ACP ToolKind enum
            content: [...],
            status: "in_progress"
          })
      continue
    case "thinking":
      // ACP 0.22 lacks a thinking notification — wrap as text with [thinking] prefix (configurable)
      // OR skip if options.suppressThinking
      continue
    case "tool_call":   // SDK status: running | completed | error
      await conn.sessionUpdate(sessionId, {
        kind: "tool_call_update",
        toolCallId: message.call_id,
        status: mapStatus(message.status),  // running → in_progress, completed → completed, error → failed
        content: message.result ? [resultBlock(message.result)] : undefined
      })
      continue
    case "status":      // cloud-only — irrelevant for local; skip
      continue
    case "task":        // task milestone — emit as text chunk with formatted prefix
      continue
    case "request":     // permission request — handled separately in Phase 4
      continue
    case "object_delta": // streamObject — not used in normal prompts; skip
      continue
    default:
      const _exhaustive: never = message
      throw new Error(`unhandled SDKMessage type: ${(_exhaustive as { type: string }).type}`)

return mapStopReason(run.wait().result.status)  // "end_turn" | "max_tokens" | "refusal" | "cancelled"
```

**Invariants:**
1. The translator MUST be exhaustive over `SDKMessage.type` — `as never` check enforces it at compile time. If we add a new SDK message variant (D45 added object_delta), the translator fails to compile until we handle it. **This is non-negotiable.**
2. The translator MUST honor the `AbortController` between messages. A cancel mid-stream stops translation.
3. The translator MUST NOT throw on individual `sessionUpdate` calls. If the upstream ACP SDK's `conn.sessionUpdate` rejects (e.g., client disconnected), we log to stderr and continue draining the SDK stream to completion (so the agent's per-turn cleanup runs).
4. The translator MUST call `run.wait()` to get the terminal result for `stopReason` mapping. Not calling `wait` would leak resources.

**`mapStopReason` table:**
| SDK `RunResult.status` | ACP `stopReason` |
|---|---|
| `"finished"` (D14) | `"end_turn"` |
| `"max_iterations"` | `"max_turn_requests"` |
| `"max_tokens"` | `"max_tokens"` |
| `"cancelled"` | `"cancelled"` |
| `"failed"` | throw — ACP doesn't have a generic failure stop reason; we surface as response-level `error` instead |

**`toolKind` mapping** (D353 quality nicety — gives ACP UI proper icons):
- `read_file`, `list_dir`, `git_diff`, `search_text` → `"read"`
- `write_file`, `apply_patch` → `"edit"`
- `run_command`, `run_vitest` → `"execute"`
- `web_search`, `fetch_url` → `"search"`
- everything else → `"other"`

#### Tasks
1. Implement `translateStream(messages, conn, sessionId, controller, options)` async function in `translator.ts`.
2. Implement `textBlock(text)`, `imageBlock(blob)`, `resultBlock(result)` helpers in `translator-blocks.ts`.
3. Implement `toolKind(name)` mapping table.
4. Implement `mapStopReason(status)`.
5. Wrap `conn.sessionUpdate` calls in `safeNotify(conn, sessionId, update, log)` helper that catches + logs + continues.
6. Wire `translateStream` into `serve.ts`'s `handlePrompt` (preview — full wiring in T3.3).

#### TDD
```
RED:     translate_assistant_text_emits_agent_message_chunk
RED:     translate_assistant_tool_use_emits_tool_call_kind
RED:     translate_tool_call_running_to_completed_emits_two_updates
RED:     translate_skips_system_and_user_echo
RED:     translate_thinking_emits_text_chunk_with_prefix
RED:     translate_thinking_suppressed_when_option_set
RED:     translate_object_delta_skipped_in_v1
RED:     translate_exhaustive_check_compiles — TS-level: adding a fake SDKMessage variant fails compile.
RED:     translate_abort_signal_mid_stream_stops_translation
RED:     translate_session_update_throw_logged_continues_drain
RED:     stop_reason_finished_to_end_turn
RED:     stop_reason_cancelled_to_cancelled
RED:     stop_reason_failed_throws_for_caller
RED:     tool_kind_read_file_returns_read
RED:     tool_kind_write_file_returns_edit
RED:     tool_kind_unknown_returns_other
GREEN:   Implement translator.ts + translator-blocks.ts.
REFACTOR: If `translateStream` exceeds biome complexity 10, extract per-variant helpers (likely needed — 9 variants in a switch is borderline).
VERIFY:  pnpm --filter @theokit/acp test translator translator-blocks
```

#### Acceptance Criteria
- [ ] All 16 RED tests now GREEN.
- [ ] Exhaustive switch with `never` check on `SDKMessage.type`.
- [ ] AbortController honored.
- [ ] `sessionUpdate` errors don't crash the translator.
- [ ] Pass: complexity ≤10 per function — translator MUST split if needed.
- [ ] Pass: ≥90% coverage on translator.ts + translator-blocks.ts.
- [ ] Pass: zero biome warnings.
- [ ] Pass: translator.ts ≤400 LoC (G8 budget).

#### DoD
- [ ] All tasks completed and validated.
- [ ] Compile-time exhaustive check verified (intentional broken-compile test in `translator.test.ts`).
- [ ] `pnpm --filter @theokit/acp test` green.

---

### T3.3 — `handlePrompt` lifecycle handler

#### Objective
Connect the translator to ACP `prompt` requests: build the `agent.send()` call, drive the translator, return `PromptResponse` with the right `stopReason`.

#### Evidence
- ACP `prompt` is a request-response (client awaits a `PromptResponse`). Updates are pushed during the call via `conn.sessionUpdate`.
- Our `agent.send()` returns a `Run`. `Run.stream()` returns AsyncGenerator. `Run.wait()` returns terminal result.

#### Files to edit
```
packages/acp/src/lifecycle.ts — add handlePrompt
packages/acp/src/serve.ts — wire handlePrompt
packages/acp/tests/lifecycle.test.ts — extend with prompt tests
```

#### Deep file dependency analysis
- `lifecycle.ts` gains the largest handler in the file. After T3.3, `lifecycle.ts` is ~350 LoC. Watch the 400 LoC budget — may need to split into `lifecycle-prompt.ts`.
- `serve.ts` no new imports — just wire one more method.

#### Deep Dives
**`handlePrompt(params, store, log)` algorithm:**
1. Look up session in store. Missing → return ACP `error: { code: "invalid_session" }`.
2. Update `session.lastUsedAt`.
3. Extract prompt via `extractPrompt(params.prompt, maxBytes)`. Throws on oversize → return `error: { code: "invalid_request" }`.
4. Reject empty text → `error: { code: "invalid_request", message: "empty prompt" }`.
5. Call `agent.send(text, { signal: session.abortController.signal })`.
6. Get the `Run` instance.
7. Call `translateStream(run.stream(), conn, params.sessionId, session.abortController, options)`.
8. `await run.wait()` for terminal status.
9. Map status → `stopReason`. Return `PromptResponse({ stopReason })`.

**Error handling decisions:**
- `agent.send` throw → catch, return `error: { code: "internal_error" }`. Log full error to stderr.
- `Run.wait()` throw → catch + classify:
  - `AgentRunError({ code: "aborted" })` → return `stopReason: "cancelled"` (NOT error — it's a normal outcome).
  - `AgentRunError({ code: "safety_blocked" })` → return `stopReason: "refusal"`.
  - Other error → return `error: { code: "internal_error" }`.
- `translateStream` throws → MUST be wrapped, returned as `error: { code: "internal_error" }`. We don't let translator bugs become unhandled rejections.

**Invariant: `handlePrompt` returns within a finite time bound**. ACP clients (Zed) have prompt timeouts (~5 min). If `agent.send` is going to take longer (e.g., huge tool-call chain), the user can cancel. We don't impose our own timeout.

#### Tasks
1. Implement `handlePrompt(params, store, options, log)` in `lifecycle.ts`.
2. Wire to `serve.ts` (add the method to `agentImpl`).
3. Replace any `// TODO: prompt` markers from Phase 2.
4. Refactor `lifecycle.ts` to split if >400 LoC: extract into `lifecycle-prompt.ts` per G8.

#### TDD
```
RED:     prompt_unknown_session_returns_invalid_session
RED:     prompt_empty_text_returns_invalid_request
RED:     prompt_oversized_returns_invalid_request
RED:     prompt_calls_agent_send_with_extracted_text
RED:     prompt_drives_translator_with_session_abort_signal
RED:     prompt_returns_end_turn_on_finished_run
RED:     prompt_returns_cancelled_on_aborted_run
RED:     prompt_returns_refusal_on_safety_blocked
RED:     prompt_returns_max_turn_requests_on_iteration_limit
RED:     prompt_unknown_run_failure_returns_internal_error
RED:     prompt_translator_throw_returns_internal_error
RED:     prompt_updates_session_last_used_at
GREEN:   Implement handlePrompt.
REFACTOR: Split lifecycle.ts if >400 LoC.
VERIFY:  pnpm --filter @theokit/acp test lifecycle
```

#### Acceptance Criteria
- [ ] All 12 RED tests now GREEN.
- [ ] Prompt errors classify correctly (aborted → cancelled, safety → refusal, others → internal_error).
- [ ] Translator throws never escape (always caught + classified).
- [ ] Pass: complexity ≤10 per function (split if needed).
- [ ] Pass: ≥90% coverage.
- [ ] Pass: zero biome warnings.
- [ ] Pass: file ≤400 LoC per file (may require split).

#### DoD
- [ ] All tasks completed and validated.
- [ ] `pnpm --filter @theokit/acp test` green.
- [ ] End-to-end Promise-based smoke test in `tests/serve.test.ts`: spawn `serveAcp`, simulate JSON-RPC stdin messages, assert correct responses.

---

## Phase 4: Tool permission flow

**Objective:** Implement the ACP `tool_call_permission_request` round-trip, bridging it to our `pre_tool_call` veto hook (D101, D355).

### T4.1 — Synthetic permission plugin

#### Objective
Install a synthetic plugin into the SDK agent that intercepts every tool call via `pre_tool_call`, sends an ACP permission request, awaits user response, and vetoes if denied.

#### Evidence
- Our `pre_tool_call` veto hook (D101) already supports `{ block: true, message: "denied" }`.
- ACP defines `requestPermission` on `ClientSideConnection` — sends a permission request, returns a `PermissionResponse` with `outcome: "selected" | "cancelled"`.

#### Files to edit
```
packages/acp/src/permission-plugin.ts (NEW) — synthetic plugin installer
packages/acp/src/types.ts — add PermissionMode type
packages/acp/src/serve.ts — wire permission plugin when permissionDefault !== "auto"
packages/acp/tests/permission-plugin.test.ts (NEW)
```

#### Deep file dependency analysis
- `permission-plugin.ts` is NEW. Uses our SDK's plugin contract (D97-D104) — specifically `kind: "general"` plugins with the `pre_tool_call` hook.
- `serve.ts` modified to install the plugin when `permissionDefault !== "auto"` and there's a `ClientSideConnection` reference available.

#### Deep Dives
**Plugin shape:**
```ts
function createPermissionPlugin(args: {
  conn: ClientSideConnection;
  sessionId: string;
  mode: "ask" | "auto" | "deny";
  trustedTools?: Set<string>;
  timeoutMs: number;  // EC-2: default 60_000
}): Plugin {
  return definePlugin({
    name: "acp-permission",
    version: "1.0.0",
    kind: "general",
    register(ctx) {
      ctx.on("pre_tool_call", async (event) => {
        if (args.mode === "auto") return; // pass-through
        if (args.mode === "deny") return { block: true, message: "denied (permissionDefault=deny)" };
        if (args.trustedTools?.has(event.toolName)) return; // pass-through trusted

        // mode === "ask": send ACP request with timeout (EC-2)
        const reqPromise = args.conn.requestPermission(args.sessionId, {
          toolCall: { toolCallId: event.callId, title: event.toolName, kind_: toolKind(event.toolName) },
          options: [
            { optionId: "allow", name: "Allow", kind: "allow_once" },
            { optionId: "deny", name: "Deny", kind: "reject_once" },
          ],
        });
        let response;
        try {
          response = await Promise.race([
            reqPromise,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("permission_timeout")), args.timeoutMs),
            ),
          ]);
        } catch (err) {
          if (err instanceof Error && err.message === "permission_timeout") {
            return { block: true, message: `permission timed out after ${args.timeoutMs}ms` };
          }
          // connection throw → treat as cancelled (defensive)
          return { block: true, message: "permission request failed (client disconnected?)" };
        }

        if (response.outcome.outcome === "cancelled") {
          return { block: true, message: "permission cancelled by client" };
        }
        if (response.outcome.outcome === "selected" && response.outcome.optionId === "deny") {
          return { block: true, message: "denied by user" };
        }
        // allow
        return;
      });
    },
  });
}
```

**Invariants:**
1. `permissionDefault: "auto"` means "no permission UI" — tool calls run as-is. The plugin is NOT installed in this mode (no listener registered).
2. `permissionDefault: "deny"` means "headless mode" — every tool call is auto-denied. Useful for testing.
3. `permissionDefault: "ask"` is the default for interactive use. Requires a live `ClientSideConnection`.
4. The plugin MUST gracefully handle `requestPermission` throwing (ACP client disconnected). Treat as cancelled → block tool call.
5. **EC-2 absorbed:** `permissionTimeoutMs?: number` option (default 60_000). Without this, an unresponsive client (user walked away from the laptop) hangs the prompt indefinitely — and since `agent.send` is held by the per-agent mutex (D19 EC-8), every subsequent prompt on the same session also blocks. Timeout → tool call vetoed with clear message.

**Edge case:** subagents (`agent.fork()`) — fork creates a new SDKAgent with a fresh plugin manager. Without intervention, forks would bypass permissions entirely. Solution: re-install the permission plugin on the forked agent. **Implementation: in T2.3's `handleForkSession`, after calling `parent.agent.fork()`, install the permission plugin on the forked agent before inserting into the store.**

#### Tasks
1. Implement `createPermissionPlugin(args)` in `permission-plugin.ts`.
2. Wire installation in `serve.ts` — when creating each session (new or loaded or forked), install the plugin if `permissionDefault !== "auto"`.
3. Update `handleForkSession` to re-install on fork.
4. Add `trustedTools?: ReadonlyArray<string>` to `AcpServerOptions` (subset that bypasses permission).
5. Add `permissionTimeoutMs?: number` to `AcpServerOptions` (default 60_000) — propagated to plugin.
6. Export `PermissionMode = "ask" | "auto" | "deny"` from `src/index.ts`.

#### TDD
```
RED:     plugin_auto_mode_passes_through_no_request
RED:     plugin_deny_mode_blocks_immediately
RED:     plugin_ask_mode_sends_request_and_blocks_on_deny
RED:     plugin_ask_mode_allows_on_allow_response
RED:     plugin_ask_mode_blocks_on_cancelled
RED:     plugin_ask_mode_blocks_on_connection_throw
RED:     plugin_ask_mode_blocks_on_timeout — EC-2: requestPermission never resolves within timeoutMs → block with timeout message.
RED:     plugin_ask_mode_timeout_message_includes_ms_value — EC-2: error message states "permission timed out after Xms".
RED:     plugin_trusted_tools_bypass_ask
RED:     plugin_installed_on_new_session
RED:     plugin_installed_on_load_session
RED:     plugin_installed_on_forked_session
RED:     plugin_not_installed_when_mode_is_auto
GREEN:   Implement permission-plugin.ts + wire in serve.ts.
REFACTOR: None expected.
VERIFY:  pnpm --filter @theokit/acp test permission-plugin
```

#### Acceptance Criteria
- [ ] All 13 RED tests now GREEN (11 original + 2 EC-2 timeout tests).
- [ ] Forked sessions get the plugin too (re-install).
- [ ] Connection throw → blocked tool call (defensive).
- [ ] **EC-2:** `permissionTimeoutMs` enforced via `Promise.race`; default 60_000; surfaced in option type.
- [ ] Pass: complexity ≤10.
- [ ] Pass: ≥90% coverage on permission-plugin.ts.
- [ ] Pass: zero biome warnings.

#### DoD
- [ ] All tasks completed and validated.
- [ ] `pnpm --filter @theokit/acp test` green.
- [ ] README documents the three permission modes + `trustedTools` option.

---

## Phase 5: CLI verb `theokit acp`

**Objective:** Add a `theokit acp` subcommand that resolves an entry file (per D357), imports the default-exported agent (or agent factory), and runs `serveAcp`.

### T5.1 — `theokit acp` command implementation

#### Objective
Hook the new subcommand into `@theokit/cli`, reuse the entry resolver from `theokit dev`, and pass the resolved agent to `serveAcp`.

#### Evidence
- `theokit dev` (`packages/cli/src/commands/dev.ts`) already resolves `src/index.ts` or `package.main` dynamically. ACP uses the same convention to minimize learning curve.
- Per D358, we also ship a `bin/theokit-acp.mjs` shim in the `@theokit/acp` package so `npx theokit-acp` works without installing the full CLI.

#### Files to edit
```
packages/cli/src/commands/acp.ts (NEW) — runAcp function
packages/cli/src/main.ts — register "acp" subcommand
packages/cli/package.json — add @theokit/acp as peer dep (CLI never bundles ACP — uses runtime resolve)
packages/cli/tests/commands/acp.test.ts (NEW)
packages/acp/bin/theokit-acp.mjs (NEW) — standalone CLI shim for direct npx
```

#### Deep file dependency analysis
- `acp.ts` mirrors `dev.ts` pattern: parse flags, resolve entry, dynamic import, validate default export, call `serveAcp`.
- `main.ts` adds one more `.command("acp")` block.
- `package.json` adds `@theokit/acp` to `peerDependencies` (NOT a hard dep — only required when user invokes `theokit acp`).
- `bin/theokit-acp.mjs` in the acp package is a small shim: parses `--entry`, dynamic-imports, calls serveAcp. Targets users who only need ACP and don't want the full CLI.

#### Deep Dives
**`runAcp(opts: AcpOptions)` algorithm:**
1. Resolve entry file via `resolveEntry(opts.entry)` (shared with dev).
2. Dynamic import. **EC-4 absorbed:** read default with CJS interop fallback — `const agent = module.default ?? module;`. Without the fallback, CJS users with `module.exports = factory` see `module.default === undefined` and get a misleading "no default export" error even though their entry is correctly shaped.
3. Validate it looks like `SDKAgent` OR a factory function (use the same `resolveAgentFactory` from T2.1 — exported from `@theokit/acp`).
4. Build `AcpServerOptions`:
   - `agent`: the resolved value
   - `info`: read from package.json (`name`, `version`)
   - `permissionDefault`: from `--permission` flag (default `"ask"`)
   - `log`: routes to stderr per D359
5. Call `await serveAcp(options)`.
6. On unhandled error → write to stderr, exit 1.

**Flags:**
- `--entry <path>` — entry file (default `src/index.ts` or `package.main`).
- `--permission <mode>` — `ask | auto | deny` (default `ask`).
- `--trusted-tools <list>` — comma-separated tool names that bypass `ask`.

**`bin/theokit-acp.mjs` shim:**
```js
#!/usr/bin/env node
import { serveAcp } from "@theokit/acp";
import { parseArgs } from "node:util";
import { resolve } from "node:path";

const { values } = parseArgs({
  options: {
    entry: { type: "string", default: "src/index.ts" },
    permission: { type: "string", default: "ask" },
  },
});

const entryPath = resolve(process.cwd(), values.entry);
const mod = await import(entryPath);
// EC-4: CJS interop — `module.exports = factory` shows up as the module itself, not as .default
const agent = mod.default ?? mod;

if (agent === undefined || agent === null) {
  process.stderr.write(`No default export found in ${entryPath}\n`);
  process.exit(1);
}

await serveAcp({ agent, permissionDefault: values.permission });
```

#### Tasks
1. Implement `runAcp` in `packages/cli/src/commands/acp.ts`.
2. Register `theokit acp [--entry <path>] [--permission <mode>] [--trusted-tools <list>]` in `main.ts`.
3. Write the `bin/theokit-acp.mjs` shim. Mark executable in `package.json` `bin` field.
4. Test the bin shim works: `pnpm exec theokit-acp --entry packages/acp/tests/fixtures/echo-agent.mjs` should start a server (stdin connected).
5. Document in `theo-opendocs/content/theokit-sdk/concepts/acp-server.mdx`.

#### TDD
```
RED:     run_acp_resolves_entry_and_calls_serve_acp
RED:     run_acp_missing_default_export_exits_2
RED:     run_acp_factory_function_passed_through
RED:     run_acp_single_agent_instance_passed_through
RED:     run_acp_permission_flag_propagated
RED:     run_acp_unknown_entry_path_exits_2
RED:     run_acp_cjs_module_exports_picked_up — EC-4: fixture with `module.exports = factory` resolves to factory without "no default" error.
RED:     run_acp_esm_default_export_picked_up — EC-4: fixture with `export default factory` resolves to factory.
RED:     bin_shim_starts_server_with_entry_file
RED:     bin_shim_cjs_module_exports_picked_up — EC-4: same fallback in the standalone shim.
GREEN:   Implement runAcp + bin shim.
REFACTOR: None expected.
VERIFY:  pnpm --filter @theokit/cli test acp; pnpm --filter @theokit/acp test bin-shim
```

#### Acceptance Criteria
- [ ] All 10 RED tests now GREEN (7 original + 3 EC-4 CJS/ESM fallback tests).
- [ ] `theokit acp --entry ./agent.ts` starts a server reading from stdin.
- [ ] `npx theokit-acp` also works (the standalone bin path).
- [ ] **EC-4:** both `export default factory` (ESM) and `module.exports = factory` (CJS) resolve correctly via `mod.default ?? mod`.
- [ ] Pass: complexity ≤10.
- [ ] Pass: ≥90% coverage on `acp.ts`.
- [ ] Pass: zero biome warnings.

#### DoD
- [ ] All tasks completed and validated.
- [ ] `pnpm -w run validate` green.
- [ ] CLI README + acp.mdx updated.

---

## Phase 6: Registry manifest + docs

**Objective:** Publish the `agent.json` ACP registry manifest so Zed and Cursor users can discover and install `@theokit/sdk` from the marketplace. Add a full concept page to `theo-opendocs`.

### T6.1 — `agent.json` manifest + docs

#### Objective
Create the registry manifest per ACP spec, validate it, and add a cookbook + concepts page documenting the entire ACP integration.

#### Evidence
- ACP registry spec defines `agent.json` shape: `schema_version`, `name`, `display_name`, `description`, `icon`, `distribution.{type, command, args, env?}`.
- Hermes ships theirs at `referencia/hermes-agent/acp_registry/agent.json` — direct precedent.

#### Files to edit
```
packages/acp/registry/agent.json (NEW)
packages/acp/registry/icon.svg (NEW) — usetheo logo
packages/acp/registry/README.md (NEW) — registry installation docs
theo-opendocs/content/theokit-sdk/concepts/acp-server.mdx (NEW)
theo-opendocs/content/theokit-sdk/cookbook/serve-as-acp-agent.mdx (NEW)
examples/acp-server/ (NEW directory)
examples/acp-server/src/index.ts (NEW) — minimal example with default-exported agent
examples/acp-server/package.json (NEW)
examples/acp-server/README.md (NEW) — Zed integration walkthrough
```

#### Deep file dependency analysis
- `agent.json` is published with the npm package (already in `files: ["registry"]`). Discoverable post-install.
- Docs files in `theo-opendocs` — separate repo. Add to current repo's `theo-opendocs` worktree if present, otherwise document as a follow-up PR.
- `examples/acp-server/` follows the established example pattern (`@theokit/sdk` workspace dep, real-LLM integration per `.claude/rules/real-llm-validation.md`).

#### Deep Dives
**`agent.json` shape:**
```json
{
  "schema_version": 1,
  "name": "usetheo-sdk",
  "display_name": "Theokit SDK",
  "description": "Run your @theokit/sdk agent as an ACP server — drives a TypeScript SDKAgent with multi-provider, multi-platform, memory + workflows + skills. Apache-2.0.",
  "icon": "icon.svg",
  "distribution": {
    "type": "command",
    "command": "npx",
    "args": ["theokit-acp", "--entry", "${ZED_PROJECT_ROOT}/src/index.ts"]
  }
}
```

**Concept page sections:**
1. What is ACP — link to upstream spec.
2. Quick start — `npm i @theokit/acp` + sample agent + Zed integration.
3. `serveAcp()` API reference (auto-generated from typedoc).
4. Permission modes — `ask`, `auto`, `deny` (D355).
5. Session lifecycle — how ACP sessions map to `agentId` (D352).
6. Streaming — what SDK messages translate to what ACP updates (D353 table).
7. Tool permissions — how `pre_tool_call` integrates (D355).
8. Custom mappings — overriding the entry resolver.
9. Troubleshooting — stdio framing issues, log redirection (D359).
10. v0.2 roadmap — ACP client support, JSON-file session persistence.

**Cookbook recipe** — minimal walkthrough:
```ts
// examples/acp-server/src/index.ts
import { Agent } from "@theokit/sdk";

export default async (sessionId) => {
  return Agent.create({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: process.cwd() },
    name: `acp-session-${sessionId}`,
  });
};
```

Plus a README explaining: copy `agent.json` to `~/.config/zed/external_agents/usetheo-sdk/agent.json`, restart Zed, open the External Agents panel, talk to the agent.

#### Tasks
1. Author `agent.json` with the right `distribution.command/args`.
2. Add a 64×64 SVG icon (or symlink workspace `assets/usetheo-mark.svg` if exists).
3. Write `concepts/acp-server.mdx` with all 10 sections.
4. Write `cookbook/serve-as-acp-agent.mdx` walkthrough.
5. Create `examples/acp-server/` with minimal default-exported factory.
6. Verify the recipe end-to-end on a real Zed install (one human pass — captured in T7.1 dogfood).

#### TDD
```
RED:     agent_json_schema_validates — fixture-mode test loads agent.json and validates against ACP registry schema.
RED:     example_agent_exports_factory — examples/acp-server/src/index.ts default export is a function.
RED:     example_agent_factory_returns_sdk_agent — calling factory returns object with agentId + send.
RED:     concept_doc_exists — concepts/acp-server.mdx file present, ≥10 H2 sections.
GREEN:   Author the files.
REFACTOR: None expected.
VERIFY:  pnpm --filter @theokit/acp test registry-schema; smoke-test examples/acp-server.
```

#### Acceptance Criteria
- [ ] `agent.json` validates against ACP registry schema.
- [ ] Concept page has all 10 sections.
- [ ] Cookbook recipe has a full Zed integration walkthrough.
- [ ] Example agent imports `@theokit/sdk`, exports a factory, runs against real LLM (per `real-llm-validation.md`).
- [ ] Pass: zero biome warnings.
- [ ] Pass: types:check on `theo-opendocs`.

#### DoD
- [ ] All tasks completed and validated.
- [ ] Example runs end-to-end with real OPENROUTER_API_KEY.
- [ ] Docs reviewed by author.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Expose `@theokit/sdk` as ACP server | T1.1, T2.1-T2.3, T3.1-T3.3 | New `@theokit/acp` package + `serveAcp()` API + session lifecycle handlers + translator |
| 2 | Stdio JSON-RPC framing | T2.2 | `AgentSideConnection` from `@agentclientprotocol/sdk@^0.22` handles framing |
| 3 | `initialize` capability advertisement | T2.2 | `handleInitialize` returns `protocolVersion`, capabilities |
| 4 | `new_session` per-session agent isolation | T2.1, T2.2 | `SessionStore` + factory resolver + `handleNewSession` |
| 5 | `load_session` (`Agent.resume` mapping) | T2.3 | `handleLoadSession` wires to `Agent.resume({ agentId: sessionId })` |
| 6 | `fork_session` (`agent.fork()` mapping) | T2.3 | `handleForkSession` wires to `agent.fork()` |
| 7 | `cancel` (lifecycle abort) | T2.2 | `handleCancel` fires `session.abortController.abort()` |
| 8 | Prompt size cap (DoS defense) | T3.1 | 2 MiB limit + `PromptTooLargeError` |
| 9 | SDKMessage → SessionUpdate translation | T3.2 | `translateStream` with exhaustive switch + `never` check |
| 10 | Tool call lifecycle (running → completed) | T3.2 | `tool_call` + `tool_call_update` notifications |
| 11 | Stop reason mapping | T3.2 | `mapStopReason` table |
| 12 | Tool permission flow | T4.1 | Synthetic plugin + `pre_tool_call` veto bridge |
| 13 | Forked sessions inherit permissions | T4.1 | Plugin re-install on fork |
| 14 | CLI verb `theokit acp` | T5.1 | `runAcp` command + entry resolver reuse |
| 15 | Standalone `npx theokit-acp` shim | T5.1 | `bin/theokit-acp.mjs` in the acp package |
| 16 | ACP registry manifest | T6.1 | `agent.json` + icon |
| 17 | Concept + cookbook docs | T6.1 | `concepts/acp-server.mdx` + `cookbook/serve-as-acp-agent.mdx` |
| 18 | End-to-end Zed dogfood | T7.1 (final) | Real Zed install + send-receive validation |
| 19 | Logging routes to stderr | T2.2 (D359) | `log` option defaults to `process.stderr.write` |
| 20 | Server-only scope (no client) | All phases (D350) | Plan explicitly defers ACP client to v0.2 |
| 21 | Backward compatibility with existing SDK | All phases | No SDK files modified — `@theokit/acp` is purely additive |
| 22 | Real-LLM validation per repo rule | T6.1, T7.1 | Example agent + dogfood both call real LLM |
| 23 | No stubs/mocks in production code | T1.1 (placeholder), T2.2 (placeholder removal) | Phase 2 DoD explicitly tracks placeholder removal |
| 24 | EC-1 cleanup on stdin close | T2.2 | `Promise.allSettled(dispose)` before serveAcp resolve |
| 25 | EC-2 permission request timeout | T4.1 | `permissionTimeoutMs` option (default 60s) via `Promise.race` |
| 26 | EC-3 CloudAgent fork rejected with invalid_request | T2.3 | try/catch UnsupportedRunOperationError → ACP invalid_request |
| 27 | EC-4 CJS module.exports = factory works | T5.1 | `mod.default ?? mod` fallback in CLI + bin shim |
| 28 | EC-5 cwd resolved to absolute before factory | T2.2, T2.3 | `path.resolve(params.cwd)` + existsSync check |
| 29 | EC-6 load_session error includes storage hint | T2.3 | Error message references `docs/recipes/conversation-storage-postgres.md` |

**Coverage: 29/29 gaps covered (100%)**

## Global Definition of Done

- [ ] All 7 phases completed (Phase 0 inventory through Phase 7 dogfood).
- [ ] All RED tests (≥95 across 7 phases — 80 original + ~15 absorbed from edge case review) now GREEN.
- [ ] Zero biome / publint / attw warnings on `@theokit/acp` package.
- [ ] Zero regressions in existing packages — full `pnpm -w run validate` green.
- [ ] `@theokit/acp@0.1.0` published to npm with `--no-provenance` (using NPM_TOKEN from .env until CI publish lands).
- [ ] `agent.json` validates against ACP registry schema.
- [ ] Concept page + cookbook recipe present in `theo-opendocs`.
- [ ] Example `examples/acp-server/` runs end-to-end with real LLM.
- [ ] CLI verb `theokit acp` documented in `theokit --help`.
- [ ] `npx theokit-acp` works without installing the full CLI.
- [ ] Backward compatibility preserved — existing 14 published packages untouched.
- [ ] `CHANGELOG.md` entries: workspace-level + `packages/acp/CHANGELOG.md` + `packages/cli/CHANGELOG.md`.
- [ ] All 12 ADRs (D349-D360) committed to `.claude/knowledge-base/adrs/`.
- [ ] **Dogfood QA PASS** — Phase 7 (Zed live integration) zero CRITICAL issues.
- [ ] **Runtime-metric proof** — for each lifecycle handler that emits to ACP, real `sessionUpdate` notification counts MUST be observed non-zero in a Zed session log (not just unit-test asserted).

## Final Phase 7: Dogfood QA (MANDATORY)

> This phase runs AFTER Phases 0-6 are complete. The plan is NOT done until dogfood passes.

**Objective:** Validate that a real human can install our ACP server in Zed (or Cursor), connect to it, send a prompt, see the streamed response, see at least one tool call complete, and cancel a long-running prompt mid-stream — without any stdio framing errors, without protocol violations, and without unhandled rejections in the server process.

### Execution

1. **Local install** — `pnpm --filter @theokit/acp build && npm pack` to produce a tarball.
2. **Zed integration** — copy `packages/acp/registry/agent.json` to `~/.config/zed/external_agents/usetheo-sdk/agent.json`, edit `distribution.args` to point at the local example (`examples/acp-server/src/index.ts`).
3. **Restart Zed** — open the External Agents panel, confirm "Theokit SDK" appears.
4. **Send 3 prompts:**
   - Prompt A: pure text question (no tool use). Expect streamed text response + `stop_reason: end_turn`.
   - Prompt B: question that triggers a tool call (e.g., "list files in src/"). Expect `tool_call` + `tool_call_update` notifications, then assistant response, then `stop_reason: end_turn`.
   - Prompt C: long task ("count to 100 step by step"). Mid-stream, click cancel in Zed. Expect server to stop within 2 seconds, `stop_reason: cancelled`.
5. **Permission flow test** — set `permissionDefault: "ask"`, trigger a tool call. Expect Zed permission dialog. Click "Deny". Expect SDK tool veto + assistant explanation.
6. **Capture logs** — server stderr should show: session creation, agent factory invocation, translator update counts, no unhandled rejections, clean shutdown on Zed disconnect.
7. **Stress test** — open 3 Zed sessions in parallel against the same agent factory. Expect 3 distinct agentIds, no cross-session leakage.
8. **Document** — capture all 7 scenarios in `.claude/knowledge-base/reviews/acp-dogfood-{YYYY-MM-DD}.md` with stderr logs + screenshots.

### Acceptance Criteria

- [ ] All 3 prompt scenarios (A, B, C) complete correctly.
- [ ] Permission deny flow correctly vetoes the tool call.
- [ ] Cancel mid-stream stops the server within 2 seconds.
- [ ] 3 parallel sessions show 3 distinct agentIds in server logs.
- [ ] Zero unhandled rejections in server stderr.
- [ ] Zero stdio framing errors in Zed's ACP client log.
- [ ] Health score ≥70/100 (subjective — based on UX smoothness).
- [ ] Zero CRITICAL issues introduced by this plan.
- [ ] Zero HIGH issues in commands/features modified by this plan.

### If Dogfood Fails

1. Identify which issues are caused by this plan's changes vs pre-existing.
2. Classify by severity (CRITICAL = data loss / corruption / crash; HIGH = wrong behavior; MEDIUM = UX rough edge; LOW = polish).
3. Fix all CRITICAL and HIGH before declaring done.
4. Re-run Phase 7 from scratch (fresh tarball, fresh Zed restart).
5. Pre-existing issues are logged but do NOT block plan completion.

---

## Out-of-scope (deferred — explicit non-goals)

These features are explicit non-goals for v0.1 and tracked for v0.2+:

| Item | Why deferred | Where to track |
|---|---|---|
| ACP **client** (calling external ACP agents) | D350 — sequencing; overlaps with Handoff (D214-D229) | Future plan: `acp-client-adapter-plan.md` |
| `authenticate` flow (token-based auth) | No clear use case for v0.1 — Zed/Cursor sessions are unauthed | v0.2 |
| `resumeSession` (distinct from loadSession) | Spec ambiguity — Zed currently uses load. Add when client demand surfaces | v0.2 |
| JSON-file session persistence | In-memory is sufficient for stdio (each process is one workspace) | v0.2 |
| Image/audio attachment translation | Our SDK's `agent.send` accepts attachments but local providers don't process them yet | v0.3 |
| `available_commands_update` (slash commands) | Requires CLI command discovery — separate effort | v0.2 |
| MCP server forwarding (`mcpServers` from new_session) | Our SDK's MCP integration is per-Agent.create config — would need runtime injection | v0.3 |
| ACP server hosted in our cloud | Theo PaaS pre-release — wait for GA | v1.0+ |
