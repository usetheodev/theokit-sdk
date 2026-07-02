---
slug: m0-harness-security-floor
milestone_id: M0
created_at: 2026-07-02
goal: Close the 4 M0 Harness security-floor defects (#54/#56/#59/#68) TDD-first
---

# Plan: M0 Harness Security Floor — close #54/#56/#59/#68

> **Version 1.1** (2026-07-02 — absorbed edge-case review: MUST-FIX EC-1 (permission-install honesty warn) into T1.1 + 5 SHOULD-TEST cases EC-2..EC-6 into TDD blocks; see `reviews/m0-harness-security-floor-edge-cases-plan-2026-07-02.md`). **Version 1.0** — Close the four M0 Harness security-floor defects surfaced by the cross-validation
> sweep and blueprinted in `knowledge-base/discoveries/blueprints/m0-harness-security-floor-blueprint.md`: the ACP `pre_tool_call` veto that
> never wires (#68, live security defect), the cross-tenant active-recall cache leak (#56, crit), the
> full-`process.env` leak into child processes + dishonest sandbox docs (#54, crit), and the MCP
> request that never times out (#59, crit). Each fix is TDD-first with a RED regression test that
> fails against today's code, then the minimal fix, then wiring + integration proof.

## Goal

> "Enable the Theo Harness to enforce security at its plugin / memory / process / protocol boundaries
> so that defects #54, #56, #59, #68 are closed, measured by 4 new RED-first regression tests passing
> (ACP `deny` blocks a tool from executing; two same-query different-tenant recalls return isolated
> cache entries; a secret env var present in the parent is absent from a spawned child; a silent MCP
> stdio server yields a typed timeout error) with the full `@theokit/sdk` + `@theokit/acp` suites green."

## Context

M0 of `theokit-tools/ROADMAP.md` (owned by `theokit-sdk/ROADMAP.md`) is the Harness **security floor**:
the 3 CRITICALs + the live ACP defect must close before anything builds atop the Harness. The four
defects were located with `file:line` evidence by the 2026-06/07 cross-validation sweep (5 peers) and
their fix approaches were blueprinted (SHIPPABLE 98.8) at
`knowledge-base/discoveries/blueprints/m0-harness-security-floor-blueprint.md`. Grounding reads on
2026-07-02 confirmed every defect in current source. The most severe is #68: the ACP permission
plugin's `pre_tool_call` veto is **never aggregated** into the plugin manager (see Baseline Context),
so a tool the user tried to gate runs unchecked — a live security defect, not a latent risk.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/internal/plugins/manager.ts` | 193 | `2761a55` (2026-05-20) | Aggregates plugin registrations; runs `pre_tool_call`/`pre_user_send`/`post_assistant_reply` hooks | `initialize()` stays single-shot for the bulk path; `runPreToolCallHooks` block-wins semantics unchanged; existing hook aggregation intact |
| `packages/sdk/src/internal/plugins/types.ts` | 145 | `2761a55` (2026-05-20) | Plugin + hook type contracts (`PreToolCallDecision`, `Plugin`) | `PreToolCallDecision {block:true; message}` shape unchanged (public) |
| `packages/acp/src/permission-plugin.ts` | 124 | `b70747b` (2026-06-03) | Bridges ACP `requestPermission` → SDK `pre_tool_call` veto | `askWithTimeout` behavior + veto messages unchanged; idempotent per session |
| `packages/sdk/src/internal/memory/active-memory.ts` | 306 | `73895a5` (2026-06-11) | Active-recall blocking pass before `agent.send()` | recall status/summary contract unchanged; `signal`/breaker/telemetry paths intact |
| `packages/sdk/src/internal/memory/active-memory-cache.ts` | 100 | `ba2e521` (2026-06-09) | TTL cache; `cacheKey` ALREADY supports `tenantCtx` | key derivation + NUL-separator + LRU/TTL unchanged (only consumed, not modified) |
| `packages/sdk/src/internal/runtime/lifecycle/spawn-collect.ts` | 72 | `31ba23b` (2026-06-18) | Shared `spawn` wrapper (hooks executor + shell tool) | timeout/SIGKILL + stdout/stderr collection + `SpawnCollectResult` shape unchanged |
| `packages/sdk/src/sandbox/local-sandbox.ts` | 62 | `540b570` (2026-06-10) | Subprocess exec, NO OS isolation | `execute()`/`uploadFile()` signatures unchanged; timeout + truncation intact |
| `packages/sdk/src/sandbox/types.ts` | 114 | `e34dbd3` (2026-06-22) | `SandboxConfig`, `ExecuteResult`, `SandboxBackend` | additive-only change (`env?` field); existing fields unchanged |
| `packages/sdk/src/internal/mcp/client.ts` | 242 | `ed6b620` (2026-05-19) | Real MCP client (stdio + http) for the agent loop | `McpClient` interface + JSON-RPC wire format unchanged; add timeout without breaking existing calls |
| `packages/sdk/src/internal/runtime/lifecycle/env-policy.ts` (NEW) | 0 | — | (file to be created) — stdlib env-allowlist/secret-scrub helper | — |
| `packages/sdk/tests/plugins/manager-register.test.ts` (NEW) | 0 | — | (RED test — post-init register + replace-by-name) | — |
| `packages/acp/tests/permission-plugin.test.ts` | (exists) | `b70747b` (2026-06-03) | ACP permission plugin tests | extend with the veto-actually-blocks RED test |
| `packages/sdk/tests/memory/active-memory-tenant-isolation.test.ts` (NEW) | 0 | — | (RED test — cross-tenant cache isolation) | — |
| `packages/sdk/tests/runtime/spawn-collect-env-policy.test.ts` (NEW) | 0 | — | (RED test — secret var absent from child env) | — |
| `packages/sdk/tests/mcp/client-timeout.test.ts` (NEW) | 0 | — | (RED test — silent server yields typed timeout) | — |

### Current callers / dependents

- **Symbol:** `PluginManager` in `plugins/manager.ts`
  - Callers (production): instantiated + `.initialize(codePlugins)` at `local-agent.ts:198`; `pluginManager()` accessor at `local-agent.ts:213`; consumed by `tool-dispatch.ts:190` (`runPreToolCallHooks`).
  - Callers (ACP): `permission-plugin.ts:115` calls `mgr.register(plugin)` / `mgr.initialize([plugin])` — the `register` branch is currently dead because the method does not exist.
  - External: `@theokit/acp` depends on `@theokit/sdk`'s plugin manager shape (the `pluginManager()` accessor is `@internal` but reached via cast in `permission-plugin.ts:109`).
- **Symbol:** `runActiveMemory` in `active-memory.ts`
  - Callers (production): `local-agent-memory.ts:84` — **already passes** `userId`, `namespace: "default"` (`:118`), `scope: "session"` (`:119`). The identity reaches `runActiveMemory` args; it is simply not threaded into `cache.get/set`.
  - Callers (tests): existing active-memory tests under `packages/sdk/tests/`.
- **Symbol:** `spawnAndCollect` in `spawn-collect.ts`
  - Callers (production): `hooks-executor.ts`, `shell-tool.ts`. Both rely on `env: {...process.env, ...options.env}` today.
- **Symbol:** `LocalSandbox` / `SandboxConfig` in `sandbox/`
  - Callers (production): `sandbox/index.ts`, `sandbox/provision.ts`, `internal/eval/code-runner.ts`, `scorers.ts`.
- **Symbol:** `createMcpClient` / `McpClient.callTool` in `mcp/client.ts`
  - Callers (production): `agent-loop/tool-executors.ts`, `agent-loop/loop-context-init.ts`, `real-local-run.ts`.

### Domain glossary

- **Active recall** — a blocking memory search issued BEFORE `agent.send()` assembles the system prompt; its summary is prepended as an `<active-memory>` block.
- **tenantCtx** — `{ namespace?, userId?, scope? }`, the isolation tuple that MUST enter the cache key so two tenants never share a recall entry.
- **pre_tool_call veto** — a plugin hook returning `{block:true, message}` that makes the loop skip the tool and surface `message` as a tool_result so the LLM self-corrects.
- **spawn wrapper** — `spawnAndCollect`, the single subprocess entry shared by the hooks executor and the shell tool.
- **env policy** — inherit-mode + secret-exclude model (codex `ShellEnvironmentPolicy`) deciding which parent env vars a child process receives.

### Architecture boundaries affected

- `plugins/` (SDK internal) ← `@theokit/acp` (adapter): #68 adds a public-ish `register` on the plugin manager the ACP adapter already assumes. Direction: adapter → harness internal (existing, tightened).
- `memory/` adapter: #56 is intra-module wiring (no boundary crossing).
- `runtime/lifecycle` + `sandbox/`: #54 adds a leaf helper `env-policy.ts` consumed by the spawn wrapper and sandbox — no inward dependency on outer layers (`architecture.md` DIP respected).
- `mcp/` adapter: #59 is intra-adapter (timeout inside the client). Typed errors reuse `errors.ts` (`NetworkError`).

## Prior Art & Related Work

- **Internal blueprint:** `knowledge-base/discoveries/blueprints/m0-harness-security-floor-blueprint.md` (SHIPPABLE 98.8) — Techniques T1 (tenant key), T2 (env policy), T3 (veto enforcement), ADRs D1–D4. This plan implements those ADRs.
- **Reference projects (read-only):**
  - codex `reference/codex/codex-rs/protocol/src/shell_environment.rs:46-149` — inherit-mode + `*KEY*/*SECRET*/*TOKEN*` default-exclude model (#54).
  - adk-js `reference/adk-js/core/src/plugins/plugin_manager.ts:276` — non-undefined before-callback short-circuit (#68); `core/test/plugins/plugin_manager_test.ts:207` — assert subsequent handler not called.
  - crewAI `reference/crewAI/lib/crewai/src/crewai/memory/memory_scope.py:38` — scope-path partitioning (#56).
  - mastra `reference/mastra/packages/memory/src/processors/observational-memory/retry.ts:135` + codex `reference/codex/sdk/typescript/tests/abort.test.ts:32` — stdlib `AbortSignal`/`setTimeout` timeout, no dep (#59).
- **Project rules:** `parsimony-ladder.md` (stdlib before dep), `error-handling.md` (typed, fail-closed), `testing.md §4.1` (negative-case asserts the specific typed error), `no-stubs-no-mocks-no-wired.md` (the fix must be wired), `architecture.md` (DIP leaf helpers).

## Objective

- [ ] #68 — `PluginManager.register(plugin)` exists (post-init, replace-by-name); ACP `deny`/`ask` veto blocks a tool from executing (RED test proves today it does NOT).
- [ ] #56 — `runActiveMemory` threads `{namespace,userId,scope}` into `cache.get`/`cache.set`; two same-query different-tenant recalls do not share a cache entry.
- [ ] #54 — `env-policy.ts` helper scrubs secret-like vars by default; `spawnAndCollect` + `SandboxConfig.env` use it; `LocalSandbox` docs state NO OS isolation honestly.
- [ ] #59 — MCP stdio `request` rejects a typed timeout + cleans the pending map; MCP http `request` passes `AbortSignal.timeout`.
- [ ] Full `@theokit/sdk` + `@theokit/acp` suites green; typecheck + Biome clean; CHANGELOGs updated.

## ADRs

### D1 — #68: post-init `PluginManager.register(plugin)` with replace-by-name (implements blueprint D4)

**Decision:** Add `register(plugin): Promise<void>` that dispatches ONE plugin post-init (runs the same `#dispatchPlugin` + `#merge` path as `initialize`) WITHOUT the single-shot guard, and REPLACES any prior registration whose plugin name matches (drops that plugin's previously-aggregated hooks before merging the new ones) so the per-prompt ACP re-install is idempotent.

**Rationale:** Dispatch already honors `{block:true}` (`tool-dispatch.ts:79`, mirrors adk `plugin_manager.ts:276`); the only gap is that the ACP plugin is never aggregated because `register` is missing and `initialize` throws-when-re-called (swallowed by `void` at `permission-plugin.ts:122`). `installPermissionPlugin` already branches on `typeof mgr.register === "function"` — making the method real is the minimal wiring fix (`no-stubs-no-mocks-no-wired.md`).

**Alternatives considered:** (a) Install the permission plugin at `Agent.create` as a configured plugin — rejected: ACP permission mode + `conn` are per-prompt/per-session, unknown at create. (b) Relax `initialize` to be multi-call — rejected: its single-shot guard is a legitimate invariant for the bulk path; late single-plugin registration is a distinct named operation. (c) Append without replace — rejected: `installPermissionPlugin` runs per prompt → duplicate `pre_tool_call` handlers accumulate (the plugin doc already promises replace).

**Consequences:** ACP `deny`/`ask` blocks tools. Constrains: `register` must reject a `model-provider`/`memory` plugin registered after provider resolution (out of M0 scope — permission is a `general` plugin; guard with a clear error).

### D2 — #56: thread tenantCtx into cache get/set (implements blueprint D1)

**Decision:** Pass `{ namespace: args.namespace, userId: args.userId, scope: args.scope }` to `cache.get` (`active-memory.ts:131`) and `cache.set` (`:247`). No new abstraction.

**Rationale:** the collision-safe key infra already exists (`active-memory-cache.ts:97`); the caller already supplies the identity (`local-agent-memory.ts:84,118-119`). Pure dead-wiring fix (`no-stubs-no-mocks-no-wired.md §3`), KISS.

**Alternatives considered:** (a) re-key by `userId` only — rejected: namespace + scope also partition; the NUL-separated tuple handles all three. (b) a `TenantScopedCache` wrapper — rejected: YAGNI, the arg exists.

**Consequences:** two tenants with identical query text get isolated cache entries. No API change.

### D3 — #54: stdlib env-policy helper (secret-scrub default) + honest sandbox docs (implements blueprint D2)

**Decision:** New leaf `env-policy.ts` exporting `resolveChildEnv(options)` with modes `inherit-scrubbed` (default: inherit all parent env MINUS secret-like keys `*KEY*/*SECRET*/*TOKEN*/*PASSWORD*/*_AUTH*` case-insensitive) · `core` (allowlist of PATH/HOME/LANG/… + explicit adds) · `all` (explicit opt-out, current behavior). `spawnAndCollect` uses `inherit-scrubbed` by default; `SandboxConfig` gains an optional `env` policy field. `LocalSandbox` doc rewritten to state plainly it provides NO OS isolation (only env-scrub + timeout + output cap).

**Rationale:** codex proves the model (`shell_environment.rs:46`); a plain object-filter is stdlib (parsimony rung 2); fail-closed on secrets by default (`error-handling.md`); honest labeling (Rule 3). Keeping `sh -c` preserves the documented shell-command contract; the security fix is the env scrub, not removing the shell.

**Alternatives considered:** (a) drop `sh -c` for arg-vector exec — rejected: breaks the shell-command API contract; separate opt-in, out of M0. (b) ship DockerSandbox now — rejected: XL, out of M0. (c) default to `core` allowlist — rejected: would break existing spawns that legitimately read non-secret env; `inherit-scrubbed` is the safe non-breaking default.

**Consequences:** secret env vars stop reaching children by default. Small risk: a tool that legitimately needs a var named like a secret must opt into `all` or add an allow entry (documented).

### D4 — #59: stdlib timeout + typed error + pending-map cleanup (implements blueprint D3)

**Decision:** stdio `request` (`mcp/client.ts:184`) wraps the pending Promise in a `setTimeout`-guarded race that, on timeout, deletes the `pending` map entry and rejects a typed `NetworkError` (`code: "mcp_timeout"`); http `request` (`:217`) passes `AbortSignal.timeout(timeoutMs)` to `fetch` and maps `AbortError` to the same typed timeout. Configurable `timeoutMs` (default 30_000). Reconnect-after-drop deferred to M2.

**Rationale:** peers use stdlib only (blueprint Corner 2); Node ≥22.12 has `AbortSignal.timeout`; a hung server must not block the loop forever (`error-handling.md` fail-fast). Reuses existing `NetworkError` (`errors.ts`) — no new error type.

**Alternatives considered:** (a) `p-timeout` dependency — rejected: parsimony, stdlib suffices. (b) infinite wait — the current bug. (c) a bespoke timeout error class — rejected: `NetworkError` with a `code` is the existing convention.

**Consequences:** a silent MCP server yields a typed timeout instead of a hung agent; the pending map does not leak the timed-out entry. Callers already handle `NetworkError` from the http path.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| #54 secret-scrub could hide a legit env var whose name matches a secret pattern (e.g. `PUBLIC_KEY`) | Medium | Default `inherit-scrubbed` documented; `all`/allowlist opt-out; pattern list conservative + unit-tested against false positives | SDK |
| #68 `register` replace-by-name could drop hooks if two plugins share a name | Low | `initialize` already warns on duplicate names; `register` documents replace-by-name; ACP plugin name is session-unique (`acp-permission-${sessionId}`) | SDK |
| #59 default 30s timeout may be too short for a legitimately slow MCP tool | Low | `timeoutMs` configurable per server; default matches the sandbox default | SDK |
| #56 wiring change could alter cache-hit ratio for single-tenant workloads (now keyed by identity) | Low | Single-tenant identity is stable → same key → same hit ratio; covered by a same-tenant cache-hit test | SDK |
| Touching the hot plugin/dispatch + spawn paths risks regressions across the SDK | Medium | Full suite + typecheck gate in the Integration Validation phase; each fix isolated in its own phase/commit | SDK |

## Unresolved Questions

- Q1 — Should `register` reject a second plugin of a DIFFERENT name after init, or allow accumulation? (Plan decision: allow accumulation; only replace on name match — matches `initialize`'s additive semantics. Confirm in review.)
- Q2 — Is `*_AUTH*` too aggressive for the default secret-scrub list (could catch `OAUTH_PUBLIC`)? RESOLVED by edge-case EC-4: the `env_scrub_pattern_no_false_positive()` RED test pins the kept/dropped sets and tunes/drops `*_AUTH*` if it false-positives.
- Q3 — Does any existing consumer rely on the MCP stdio request hanging (unlikely)? (Assumed no; grep found only loop callers that await a result.)

## Dependencies

**No new runtime or dev dependencies.** All four fixes use Node stdlib only, per `parsimony-ladder.md` rung 2 and blueprint Corner 2:

| Dependency | Version | New? | Rationale |
|---|---|---|---|
| Node stdlib `AbortSignal.timeout` | Node ≥22.12 (pinned floor) | No (runtime) | #59 http timeout — no `p-timeout`/`execa` |
| Node stdlib `setTimeout` / `Promise.race` | built-in | No | #59 stdio timeout + #54 unchanged spawn timing |
| Node stdlib `node:crypto` (`createHash`) | built-in | No (already used) | #56 reuses existing `active-memory-cache.ts` key derivation |
| `NetworkError` (`packages/sdk/src/errors.ts`) | in-repo | No (already exists) | #59 typed timeout error — no new error class |

CVE surface: unchanged (no manifest edit). `/deps-audit` expected PASS.

## Dependency Graph

```
Phase 1 (#68 veto)   ─┐
Phase 2 (#56 cache)  ─┤ independent — different modules, can implement in any order
Phase 3 (#54 env)    ─┤
Phase 4 (#59 mcp)    ─┘
        │
        ▼
Phase 5 — Integration Validation (after all four)
```

All four fixes touch disjoint modules (plugins/acp · memory · lifecycle+sandbox · mcp) → no inter-phase code dependency. Sequenced 1→4 by severity (live security defect first). Phase 5 gates on all four.

---

## Phase 1: #68 — Wire the ACP pre_tool_call veto (live security defect)

**Objective:** Make a `deny`/`ask` ACP permission actually block a tool from executing.

### T1.1 — Add `PluginManager.register(plugin)` (post-init, replace-by-name) and wire ACP

#### Objective
Add a real post-init single-plugin registration path so the ACP permission plugin's `pre_tool_call` hook is aggregated and its veto is enforced.

#### Why this step (action + reasoning)

1. **What this step does** — adds `register(plugin): Promise<void>` to `PluginManager` (dispatch one plugin post-init, replace prior hooks of the same name), and confirms `installPermissionPlugin`'s existing `typeof mgr.register === "function"` branch now wires the ACP veto.
2. **Why it is necessary now** — per Baseline Context, the manager exposes NO `register`; `installPermissionPlugin` therefore falls to `void mgr.initialize([plugin])` which throws "called twice" (swallowed) → the ACP hook is never aggregated → guarded tools run unchecked (ADR D1, blueprint T3). This is the highest-severity defect (live security), so it leads.

#### Evidence
`manager.ts:52-54` single-shot `initialize`; no `register` method (`manager.ts` full). `permission-plugin.ts:119-123` calls the non-existent `register` then `void mgr.initialize([plugin])`. `local-agent.ts:198` already initialized the manager. `tool-dispatch.ts:79-95,190` honors a `{block:true}` return. adk precedent `reference/adk-js/core/src/plugins/plugin_manager.ts:276`.

#### Files to edit
```
packages/sdk/src/internal/plugins/manager.ts — add register(plugin) + replace-by-name merge helper
packages/acp/src/permission-plugin.ts — register branch now taken; EC-1: warn (not silent) when mgr undefined AND mode !== "auto"
packages/sdk/tests/plugins/manager-register.test.ts (NEW) — RED unit: register aggregates a pre_tool_call hook post-init + replace-by-name
packages/acp/tests/permission-plugin.test.ts — RED integration: deny mode blocks the tool handler; EC-2: no-manager+deny warns (not silent)
```

#### Deep file dependency analysis
- `manager.ts` (Baseline row): add `register`; reuse private `#dispatchPlugin`/`#merge`; add a `#hooksByPlugin` index (or filter) so replace-by-name can drop prior handlers. Downstream: `tool-dispatch.ts:190` unchanged (reads aggregated hooks); ACP `permission-plugin.ts:119` now hits the real method.
- `permission-plugin.ts` (Baseline row): no signature change; the existing branch becomes live. Add a guard so re-install per prompt replaces (delegated to `register` replace-by-name).

#### Deep Dives
- Data structure: track handlers by plugin name to support replace. Minimal: store `Map<pluginName, PluginRegistrations>` alongside the aggregated view, and on `register(p)`: if name seen, subtract its old hooks from `#aggregated.hooks` before merging new ones.
- Invariant: `initialize` stays single-shot (throws on 2nd bulk call). `register` never throws on repeat — it replaces.
- Edge cases: register a `general` plugin only (permission is general); registering a `model-provider` post-init throws a typed error (providers already resolved).

#### Pseudo-code / Signatures
```pseudocode
async register(plugin):
  if plugin.kind != "general": throw ConfigurationError("late register supports general plugins only")
  if #byName.has(plugin.name): removeHooks(#byName.get(plugin.name))   -- replace-by-name
  { ctx, registrations } = createPluginContext()
  await plugin.register(ctx)
  #byName.set(plugin.name, registrations)
  #merge(registrations)

# Example: register(acpPermissionPlugin) twice on same session -> only ONE pre_tool_call handler present
```

#### Tasks
1. Add `#byName` index + `#removeHooks(registrations)` helper to `PluginManager`.
2. Implement `register(plugin)` (kind guard + replace + dispatch + merge).
3. Verify `installPermissionPlugin` takes the `register` branch (no change expected; add per-session guard only if a duplicate is observed).
4. Write RED tests first; run to confirm they fail against current code.

#### TDD
```
RED:  register_aggregates_pre_tool_call_hook_post_init() — after manager.initialize([]) then register(pluginWithPreToolCall), runPreToolCallHooks returns the plugin's decision (fails today: no register)
RED:  register_replaces_hooks_for_same_plugin_name() — register same-named plugin twice → only ONE handler runs
RED:  acp_deny_mode_blocks_tool_execution() — LocalAgent + installPermissionPlugin(deny); dispatch a tool → tool handler NEVER invoked, veto message surfaces (fails today: veto not wired)
RED:  install_permission_on_agent_without_manager_warns() — EC-1/EC-2: mgr undefined + mode "deny" → stderr warning emitted (NOT silent no-op)
GREEN: implement register + replace-by-name; EC-1: warn in installPermissionPlugin when mgr undefined && mode !== "auto"
REFACTOR: extract #removeHooks if #merge grows; else none
VERIFY: pnpm --filter @theokit/sdk test tests/plugins/manager-register.test.ts && pnpm --filter @theokit/acp test tests/permission-plugin.test.ts
```

#### Concurrency tests

(none — single-threaded) — plugin registration + hook dispatch run on the Node event loop with no shared-memory race; the only invariant is handler ordering, covered by the replace-by-name unit test.

#### Acceptance Criteria
- [ ] `register` aggregates a post-init plugin's `pre_tool_call` hook; RED test now green.
- [ ] Re-registering the same plugin name replaces (no duplicate handlers).
- [ ] ACP `deny` blocks the tool handler from running (integration test asserts handler not invoked).
- [ ] Pass: complexity ≤ 10 on changed functions; size ≤ 500 L; Biome clean; coverage ≥ 90% on `manager.ts` changes (100% on the veto path).

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` + `pnpm --filter @theokit/acp test` green
- [ ] `pnpm typecheck` zero errors
- [ ] Biome clean; file-size budget respected
- [ ] CHANGELOG `[Unreleased] § Fixed` entry (both packages) referencing #68

---

## Phase 2: #56 — Thread tenantCtx into the active-recall cache

**Objective:** Two tenants with the same query text get isolated cache entries.

### T2.1 — Pass `{namespace,userId,scope}` to cache get/set

#### Objective
Close the cross-tenant cache leak by wiring the identity the caller already supplies into the cache key.

#### Why this step (action + reasoning)

1. **What this step does** — passes `{ namespace: args.namespace, userId: args.userId, scope: args.scope }` as the 3rd `tenantCtx` arg to `cache.get` (`active-memory.ts:131`) and `cache.set` (`:247`).
2. **Why it is necessary now** — the cache key infra (`active-memory-cache.ts:97`) already supports the tuple and the caller already supplies it (`local-agent-memory.ts:84,118-119`); only the wiring is missing (ADR D2, blueprint T1). CRITICAL data-isolation defect.

#### Evidence
`active-memory.ts:131` `args.cache?.get(args.userText, cfg.queryMode)` (no 3rd arg); `:247` `args.cache?.set(args.userText, queryMode, result)` (no 4th arg). `active-memory-cache.ts:36-69` accept optional `tenantCtx`. `local-agent-memory.ts:118-119` supplies `namespace/scope`.

#### Files to edit
```
packages/sdk/src/internal/memory/active-memory.ts — add tenantCtx arg to the get (line ~131) and set (line ~247) calls
packages/sdk/tests/memory/active-memory-tenant-isolation.test.ts (NEW) — RED: same userText, different userId → distinct results; same identity → cache hit
```

#### Deep file dependency analysis
- `active-memory.ts` (Baseline row): only the two cache call-sites change; `runActiveMemory` already has `args.userId/namespace/scope`. No signature change → callers unaffected.
- `active-memory-cache.ts`: consumed only (the optional param already exists).

#### Deep Dives
- Invariant: cache-hit for identical (identity + query + mode) preserved; miss for differing identity.
- Edge cases: undefined identity fields collapse to `""` (documented) — acceptable when no tenant is set (single-tenant local).

#### Pseudo-code / Signatures
```pseudocode
const tenantCtx = { namespace: args.namespace, userId: args.userId, scope: args.scope }
const cached = args.cache?.get(args.userText, cfg.queryMode, tenantCtx)   -- line ~131
...
args.cache?.set(args.userText, queryMode, result, tenantCtx)              -- line ~247

# Example: get("hi","recent",{userId:"A"}) and get("hi","recent",{userId:"B"}) never collide
```

#### Tasks
1. Build `tenantCtx` from `args` once; pass to both cache calls.
2. Write RED isolation test first (two users, same query → distinct cached results).

#### TDD
```
RED:  active_recall_isolates_cache_by_userId() — user A caches result R_A for "q"; user B recall for "q" does NOT return R_A (fails today)
RED:  active_recall_same_identity_hits_cache() — same identity+query returns the cached entry (guards against over-keying)
GREEN: pass tenantCtx to get/set
REFACTOR: none expected
VERIFY: pnpm --filter @theokit/sdk test tests/memory/active-memory-tenant-isolation.test.ts
```

#### Concurrency tests

(none — single-threaded) — the cache Map is accessed on the event loop; isolation is a key-derivation property proven by the unit test, not a race.

#### Acceptance Criteria
- [ ] Cross-tenant isolation test green; same-tenant hit test green.
- [ ] No signature change to `runActiveMemory` (backward compat).
- [ ] Pass: complexity ≤ 10; size ≤ 500 L; Biome clean; coverage 100% on the changed lines.

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` green; typecheck clean; Biome clean
- [ ] CHANGELOG `[Unreleased] § Fixed` entry referencing #56

---

## Phase 3: #54 — Env-policy helper (secret-scrub) + honest sandbox docs

**Objective:** Secret env vars stop reaching child processes by default; the sandbox stops overclaiming isolation.

### T3.1 — `env-policy.ts` leaf helper + apply in spawn wrapper & SandboxConfig

#### Objective
Introduce a stdlib secret-scrubbing env policy and apply it where the SDK spawns processes.

#### Why this step (action + reasoning)

1. **What this step does** — creates `env-policy.ts` (`resolveChildEnv`), applies `inherit-scrubbed` default in `spawnAndCollect` (`spawn-collect.ts:33`), adds `env?` to `SandboxConfig`, and rewrites the `LocalSandbox` doc to state NO OS isolation.
2. **Why it is necessary now** — child processes inherit the FULL `process.env` (secrets included) and the sandbox advertises isolation it lacks (ADR D3, blueprint T2). CRITICAL leak + honesty gap.

#### Evidence
`spawn-collect.ts:33` `env: { ...process.env, ...(options.env ?? {}) }`. `local-sandbox.ts:2-5` doc claims isolation semantics. codex model `reference/codex/codex-rs/protocol/src/shell_environment.rs:46-149`.

#### Files to edit
```
packages/sdk/src/internal/runtime/lifecycle/env-policy.ts (NEW) — resolveChildEnv(options): applies inherit-scrubbed/core/all
packages/sdk/src/internal/runtime/lifecycle/spawn-collect.ts — use resolveChildEnv (default inherit-scrubbed)
packages/sdk/src/sandbox/types.ts — add optional `env?: EnvPolicy` to SandboxConfig
packages/sdk/src/sandbox/local-sandbox.ts — pass env policy through; rewrite doc header (no OS isolation)
packages/sdk/tests/runtime/spawn-collect-env-policy.test.ts (NEW) — RED: a secret var in parent is absent from child env; a non-secret var is present
```

#### Deep file dependency analysis
- `env-policy.ts` (NEW leaf): pure function; no inward deps. Consumed by `spawn-collect.ts` + `local-sandbox.ts`.
- `spawn-collect.ts` (Baseline row): swap the env spread for `resolveChildEnv`. Callers `hooks-executor.ts`/`shell-tool.ts` unaffected (default preserves non-secret vars).
- `sandbox/types.ts` + `local-sandbox.ts` (Baseline rows): additive `env?` field; doc rewrite.

#### Deep Dives
- Secret patterns (case-insensitive): `*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`, `*_AUTH*` — conservative; unit-tested for false positives (e.g. keep `PATH`, `HOME`; drop `OPENROUTER_API_KEY`).
- Modes: `inherit-scrubbed` (default), `core` (allowlist PATH/HOME/SHELL/LANG/LC_*/TMPDIR/TMP/TEMP/USER/LOGNAME + adds), `all` (opt-out — current behavior).
- Invariant: `spawnAndCollect` timeout/collection behavior unchanged; only the env computed changes.
- Edge cases: empty env; user override via `options.env` always wins (merged AFTER scrub).

#### Pseudo-code / Signatures
```pseudocode
type EnvPolicy = "inherit-scrubbed" | "core" | "all" | { mode, allow?: string[], deny?: string[] }
function resolveChildEnv(opts: { policy?: EnvPolicy; overrides?: Record<string,string> }): Record<string,string>
  base = switch policy:
    "all"             -> { ...process.env }
    "core"            -> pick(process.env, CORE_VARS ∪ allow)
    default/scrubbed  -> omit(process.env, keys matching SECRET_PATTERNS ∪ deny)
  return { ...base, ...overrides }   -- explicit overrides always win

# Example: process.env has FOO_TOKEN + PATH → scrubbed base has PATH, not FOO_TOKEN
```

#### Tasks
1. Create `env-policy.ts` with `resolveChildEnv` + pattern list + CORE_VARS.
2. Apply in `spawn-collect.ts` (default scrubbed).
3. Add `env?` to `SandboxConfig`; thread through `LocalSandbox.execute`.
4. Rewrite `LocalSandbox` doc header (no OS isolation; env-scrub + timeout only).
5. RED test first (secret absent, non-secret present).

#### TDD
```
RED:  spawn_scrubs_secret_env_by_default() — set process.env.FAKE_SECRET_TOKEN; spawnAndCollect a printenv-style child → child env lacks FAKE_SECRET_TOKEN (fails today)
RED:  spawn_keeps_nonsecret_and_path() — PATH + a plain var still present in child
RED:  env_policy_all_opt_out_preserves_secret() — policy "all" keeps the secret (explicit opt-out contract)
RED:  env_override_reinjects_scrubbed_secret() — EC-3: overrides.MY_TOKEN present even under scrubbed default (explicit override wins)
RED:  env_scrub_pattern_no_false_positive() — EC-4: PATH/HOME/PUBLIC_BASE_URL kept; API_KEY/X_SECRET/GH_TOKEN/DB_PASSWORD dropped (tunes *_AUTH*)
GREEN: implement resolveChildEnv + wire
REFACTOR: extract SECRET_PATTERNS/CORE_VARS consts; none else
VERIFY: pnpm --filter @theokit/sdk test tests/runtime/spawn-collect-env-policy.test.ts
```

#### Concurrency tests

(none — single-threaded) — `resolveChildEnv` is a pure function; the spawn timeout race is unchanged and already covered by existing spawn tests.

#### Acceptance Criteria
- [ ] Secret var absent from child env by default; non-secret + PATH present; `all` opt-out preserves.
- [ ] `LocalSandbox` doc states NO OS isolation.
- [ ] `SandboxConfig.env` additive (existing callers compile unchanged).
- [ ] Pass: complexity ≤ 10; size ≤ 500 L; Biome clean; coverage ≥ 90% (100% on the scrub function).

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` green; typecheck clean; Biome clean
- [ ] CHANGELOG `[Unreleased] § Fixed` + `§ Security` entry referencing #54

---

## Phase 4: #59 — MCP request timeout (stdio + http)

**Objective:** A silent MCP server yields a typed timeout instead of hanging the agent loop.

### T4.1 — Timeout + typed error + pending-map cleanup

#### Objective
Bound every MCP request so a non-responding server cannot block the loop forever.

#### Why this step (action + reasoning)

1. **What this step does** — wraps the stdio `request` pending Promise in a `setTimeout` race that deletes the pending entry and rejects a typed `NetworkError("mcp_timeout")`; passes `AbortSignal.timeout(timeoutMs)` to the http `fetch`.
2. **Why it is necessary now** — `StdioMcpClient.request` (`mcp/client.ts:184`) creates a Promise that never resolves if the server is silent; `HttpMcpClient.request` (`:217`) has no fetch timeout (ADR D4, blueprint D3). CRITICAL liveness defect.

#### Evidence
`mcp/client.ts:184-186` `new Promise((resolve) => this.pending.set(id, resolve))` — no timeout/cleanup. `:217-221` `fetch` without signal. `errors.ts` `NetworkError` exists.

#### Files to edit
```
packages/sdk/src/internal/mcp/client.ts — stdio request timeout+cleanup+reject; http request AbortSignal.timeout; timeoutMs config (default 30_000)
packages/sdk/tests/mcp/client-timeout.test.ts (NEW) — RED: a stdio server that never replies → request rejects NetworkError within timeout; pending map emptied
```

#### Deep file dependency analysis
- `mcp/client.ts` (Baseline row): `request` in both transports gains a timeout; the `pending` map (stdio) must delete the timed-out id. Callers `tool-executors.ts`/`loop-context-init.ts`/`real-local-run.ts` already await `callTool`/`listTools` and handle rejections → typed timeout propagates cleanly.

#### Deep Dives
- Data structure: `pending: Map<number, resolver>`; on timeout, `pending.delete(id)` then reject. Store the reject alongside resolve, OR resolve with a sentinel that `rpcCall*` maps to a throw. Simplest: change pending value to `{resolve, reject}` and race a timer.
- Invariant: a late reply for a timed-out id is ignored (id already deleted → `handleLine` finds no resolver, returns).
- Edge cases: `close()` during a pending request rejects all pending (already partially handled via `on("error")`); ensure timers are cleared on resolve + on close (no leak).

#### Pseudo-code / Signatures
```pseudocode
request(method, params):
  id = nextId++
  child.stdin.write(payload)
  return new Promise((resolve, reject) =>
    timer = setTimeout(() => { pending.delete(id); reject(NetworkError("MCP <name> timed out", {code:"mcp_timeout"})) }, timeoutMs)
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg) }))

# http: fetch(url, { signal: AbortSignal.timeout(timeoutMs) }) ; catch AbortError -> throw NetworkError mcp_timeout
```

#### Tasks
1. Add `timeoutMs` (config field, default 30_000).
2. stdio: race the pending Promise with a timer; delete pending id + reject typed on timeout; clear timer on resolve/close.
3. http: pass `AbortSignal.timeout`; map `AbortError` → `NetworkError` `mcp_timeout`.
4. RED test first (fake stdio server that never replies).

#### TDD
```
RED:  stdio_request_rejects_typed_timeout_when_server_silent() — server that reads but never writes → request rejects NetworkError code=mcp_timeout within timeoutMs (fails today: hangs)
RED:  stdio_pending_map_empty_after_timeout() — after the timeout, the pending map has no entry (no leak)
RED:  http_request_times_out_via_abort_signal() — fetch stub that never resolves + short timeout → NetworkError mcp_timeout
RED:  close_during_pending_rejects_and_clears_timers() — EC-5: close() while a request is pending → promise rejects, no timer leak / unhandled rejection
RED:  http_timeout_maps_abort_to_typed_error() — EC-6: AbortError → NetworkError mcp_timeout; a generic fetch error stays on the existing error path (not mislabeled timeout)
GREEN: implement timeout + cleanup for both transports
REFACTOR: share the timeout-error factory between transports; none else
VERIFY: pnpm --filter @theokit/sdk test tests/mcp/client-timeout.test.ts
```

#### Concurrency tests

Applicable — async pending request + timer. This task's `cancellation propagation` assertion is the race-aware proof: `stdio_pending_map_empty_after_timeout()` asserts the timer firing cancels the pending entry, and a late reply after timeout is a no-op (`handleLine` finds no resolver → the settled Promise is never double-resolved). `close()` during a pending request likewise propagates cancellation (rejects + clears the timer).

#### Acceptance Criteria
- [ ] Silent stdio server → typed `NetworkError` `mcp_timeout` within `timeoutMs`; pending map emptied.
- [ ] http fetch bounded by `AbortSignal.timeout`; `AbortError` mapped to the same typed error.
- [ ] Late reply after timeout is a no-op (no double-resolve, no unhandled rejection).
- [ ] Pass: complexity ≤ 10; size ≤ 500 L; Biome clean; coverage ≥ 90% (100% on timeout paths).

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` green; typecheck clean; Biome clean
- [ ] CHANGELOG `[Unreleased] § Fixed` entry referencing #59

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | #68 ACP `pre_tool_call` veto never wired (live security) | T1.1 | `PluginManager.register` + replace-by-name; veto blocks tool (integration test) |
| 2 | #56 cross-tenant active-recall cache leak (crit) | T2.1 | thread tenantCtx into cache get/set; isolation test |
| 3 | #54 full `process.env` leak into children + dishonest sandbox docs (crit) | T3.1 | `env-policy.ts` secret-scrub default in spawn + SandboxConfig.env; honest docs; secret-absent test |
| 4 | #59 MCP request never times out (crit) | T4.1 | stdlib timeout + typed error + pending cleanup (stdio) + `AbortSignal.timeout` (http) |

**Coverage: 4/4 gaps covered (100%)**

## Global Definition of Done

- [ ] All 5 phases completed — every task's DoD checklist ticked and verified
- [ ] All tests pass — `pnpm test` exits 0 (sdk + acp suites green)
- [ ] Typecheck emits zero errors — `pnpm typecheck` exits 0
- [ ] Biome emits zero warnings — `pnpm lint` exits 0 on changed files
- [ ] Every changed file measures ≤ 500 lines — `wc -l` on each file in the touched set returns ≤ 500 (per `architecture.md`)
- [ ] CHANGELOG updated — `packages/sdk/CHANGELOG.md` + `packages/acp/CHANGELOG.md` each contain a new `[Unreleased] § Fixed`/`§ Security` entry referencing #54/#56/#59/#68 (Rule 6)
- [ ] Backward compatibility holds — `pnpm typecheck` passes with no public signature change (`register` + `SandboxConfig.env` are additive) and existing consumer tests stay green
- [ ] The 4 RED regression tests each print a FAIL against pre-fix code (captured in the implementation log) then print PASS after the fix
- [ ] Runtime-metric proof — the veto, timeout, and env-scrub effects are asserted in integration tests (`pnpm test` observes them non-vacuously), not just compiled
- [ ] Plan file moves to `knowledge-base/plans/completed/` only after `/review` returns READY_TO_MERGE AND the PR merges

## Failure scenarios (external I/O — MCP + subprocess)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| MCP stdio server (subprocess) | server reads request but never replies | fake stdio server in-test that consumes stdin, writes nothing | `request` rejects `NetworkError` `mcp_timeout` within `timeoutMs`; pending map emptied; no hang |
| MCP http server (fetch) | endpoint never responds | injected `fetch` stub that returns a never-resolving Promise + short `timeoutMs` | `AbortSignal.timeout` aborts; mapped to `NetworkError` `mcp_timeout` |
| Child process (spawn) | process inherits secret env | set `process.env.FAKE_SECRET_TOKEN`; spawn a child that echoes its env | secret absent from child env under default `inherit-scrubbed` |
| MCP stdio server | late reply AFTER timeout | fake server replies after `timeoutMs` elapsed | late reply is a no-op (id already deleted); no double-resolve, no unhandled rejection |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the four fixes work together in the real SDK/ACP suites, not just as isolated units.

### Execution
```
pnpm --filter @theokit/sdk test        # full sdk suite (incl. new memory/mcp/runtime/plugins tests)
pnpm --filter @theokit/acp test        # full acp suite (incl. veto integration test)
pnpm typecheck                         # zero type errors across workspace
pnpm lint                              # Biome clean
pnpm --filter @theokit/sdk test -- --coverage   # ≥ 90% on changed files
```

Chaos/failure pass (the `## Failure scenarios` rows):
```
pnpm --filter @theokit/sdk test tests/mcp/client-timeout.test.ts tests/runtime/spawn-collect-env-policy.test.ts
pnpm --filter @theokit/acp test tests/permission-plugin.test.ts
```

### Acceptance Criteria
- [ ] All suites green (sdk + acp)
- [ ] Coverage ≥ 90% on changed files (100% on the four security paths)
- [ ] Zero type errors; zero Biome warnings
- [ ] Each of the 4 `## Failure scenarios` rows exercised and expected behavior observed
- [ ] The veto/timeout/env-scrub effects observed in integration tests (not just compiled)

### If Validation Fails
1. Separate plan-caused failures from pre-existing.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description; they do not block M0.
