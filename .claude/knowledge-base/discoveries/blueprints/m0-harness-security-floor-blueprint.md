# Blueprint: M0 Harness Security Floor — Fix Approaches

> **Version 1.0** — Synthesizes the CORRECT FIX APPROACH for the 4 M0 security-floor defects
> (#56 cross-tenant cache leak, #54 child-process env leak + sandbox honesty, #59 MCP request never
> times out, #68 ACP `pre_tool_call` veto never wired) from peer implementations (codex, adk-js,
> crewAI, mastra, opencode) plus our own dispatch code. **Headline finding:** #68 is a CONFIRMED
> live security defect — the ACP permission plugin's `pre_tool_call` hook is never aggregated
> because `PluginManager` exposes no `register()` and its single-shot `initialize()` throws when
> re-called (swallowed by `void`), so guarded tools execute WITHOUT the permission check. Informs
> `/to-plan M0`.

**Slug:** `m0-harness-security-floor`
**Source plan:** `.claude/knowledge-base/discoveries/plans/m0-harness-security-floor-plan.md`
**Owner:** paulohenriquevn
**Generated:** 2026-07-02 via `/discover-execute` (inline per-iteration contract — nested ralph-loop skipped to avoid concurrency with the active `/goal` Stop hook, per `loop-engine-convention § Anti-patterns`)
**Confidence verdict:** SHIPPABLE (98.8 — `/discover-confidence` 2026-07-02; coverage 100 / citations 100 / completeness 100 / structural 92; zero hard caps)

## Context

M0 is the Harness security floor. Grounding reads (2026-07-02) confirmed all four defects in current
source. This blueprint captures the transferable fix MODEL per defect (peer precedent + our exact
defect locus) so `/to-plan M0` writes a TDD-first plan with no reinvention (Rule 9) and no guesswork.

## Objective

Let `/to-plan M0` decide the exact fix shape for #56/#54/#59/#68, each grounded in peer evidence and
(for #68) the pinned defect locus in our own code.

---

## Coverage Corner 1 — Integration Tests

How peers assert the three security boundaries our fixes must protect.

### adk-js — permission veto + scoped-state isolation (TS)

- **Veto assertion shape** — a denied `beforeToolCallback` is asserted by the tool NOT running and an
  error/blocked result surfacing:
  - `reference/adk-js/core/test/plugins/security_plugin_test.ts:103` — DENY outcome asserts the
    result carries an `Unauthorized`-style error (denied call does not execute).
  - `reference/adk-js/core/test/plugins/plugin_manager_test.ts:207` — "stops subsequent plugins on
    early exit": `expect(plugin2.callLog).not.toContain('beforeRunCallback')` — the first
    non-undefined return short-circuits. This is the exact assertion our #68 test must mirror: once
    a veto returns `{block:true}`, the tool handler is never invoked.
- **Scoped-state isolation** — `reference/adk-js/core/test/sessions/state_test.ts:12` asserts
  prefix-scoped state get/set stays within its partition.

### codex — env-not-leaked (Rust)

- `reference/codex/codex-rs/core/src/exec_env_tests.rs:14` `test_core_inherit_defaults_keep_sensitive_vars`
  — asserts that with `ignore_default_excludes: true`, secret-like vars (API_KEY, SECRET_TOKEN) ARE
  present (baseline).
- `reference/codex/codex-rs/core/src/exec_env_tests.rs:38` `test_core_inherit_with_default_excludes_enabled`
  — asserts that with default-excludes ON, `*KEY*`/`*SECRET*`/`*TOKEN*` vars are ABSENT from the
  child env. **This is the exact negative-case shape our #54 test needs**: assert a secret var in
  the parent process is NOT in the spawned child's env.

**Transferable test model (all three):** assert the *absence* of the dangerous effect — the denied
tool did not run; the secret var is not in the child env; the other tenant's result is not returned.
Negative-case discipline per `rules/testing.md §4.1` (assert the specific excluded var / denied call,
not merely "it throws").

---

## Coverage Corner 2 — Dependencies

### Timeout mechanism — stdlib is sufficient (Q6, #59/#54)

Peers implement request/subprocess timeout with **Node stdlib only** — no `p-timeout`/`execa` dep:

| Peer | Mechanism | Error shape | Citation |
|---|---|---|---|
| codex TS SDK | `AbortController` + `signal` passed to run; rejects AbortError | `The operation was aborted.` | `reference/codex/sdk/typescript/tests/abort.test.ts:32` |
| mastra | custom `sleep(ms, abortSignal)` = `setTimeout` + `abortSignal.addEventListener('abort')` | `Error('The operation was aborted.')` | `reference/mastra/packages/memory/src/processors/observational-memory/retry.ts:135` |
| opencode | `setTimeout(..., options.timeout)` + reject | `Error('Timeout waiting for server...')` | `reference/opencode/packages/sdk/js/src/server.ts` |

**Decision (parsimony ladder rung 2, EC-3):** our #59 fix uses Node stdlib `AbortSignal.timeout(ms)`
(available on our pinned Node ≥22.12) for the HTTP path, and a `setTimeout`-guarded `Promise.race`
that rejects a typed error + clears the pending map entry for the stdio path. **No new dependency.**
Same stdlib approach for the #54 sandbox (env allowlist is a plain object filter; no dep).

---

## Coverage Corner 3 — Tools

**ADR-deferred (D3 of the discovery plan + `<!-- DEFER-CORNER: tools -->`).** The four fixes introduce
no new build/test/CI tooling — they run on the existing locked toolchain (Vitest / tsup / tsc-strict /
Biome). The parsimony check that a Tools corner would otherwise motivate is covered by Corner 2 (Q6):
stdlib before dependency. No `docker`, no new lint rule, no new CI job.

---

## Coverage Corner 4 — Techniques

### T1 — Tenant/scope key composition (#56)

| Source | Approach | Citation |
|---|---|---|
| crewAI | Memory is a hierarchical scope path (`/crew/research/agent1`), `/`-separated, normalized; every op is scoped under a root path; `join_scope_paths(root, scope)` merges. | `reference/crewAI/lib/crewai/src/crewai/memory/memory_scope.py:38`; `reference/crewAI/lib/crewai/src/crewai/memory/unified_memory.py:686` |
| adk-js | Static prefixes `app:` / `user:` / `temp:` partition state visibility (never collide across partitions). | `reference/adk-js/core/src/sessions/state.ts:12` |
| **OUR infra (ready)** | `active-memory-cache.ts:97` `cacheKey(userText, queryMode, ctx?)` ALREADY composes `sha256([queryMode, ctx.namespace, ctx.userId, ctx.scope, userText].join('\x00'))` — NUL-separated to prevent `"ab"+"cd"` vs `"a"+"bcd"` collision. | `packages/sdk/src/internal/memory/active-memory-cache.ts:88-100` |

**The gap is not the model — it is the wiring.** The cache key already supports the exact
(namespace, userId, scope) tuple with a collision-safe separator (mirrors crewAI's normalized
path + adk's explicit-prefix ideas). The caller `active-memory.ts:131` (`get`) and `:247` (`set`)
call WITHOUT the 3rd `tenantCtx` arg, so `ctx` is `undefined` → all tenant fields collapse to `""`
→ two tenants with the same query text share a cache entry. `runActiveMemory` already receives
`args.userId` / `args.namespace` / `args.scope` (`active-memory.ts:76-78`) — they simply are not
threaded into the cache calls.

**Fix model:** pass `{ namespace: args.namespace, userId: args.userId, scope: args.scope }` as the
3rd arg to both `cache.get` (`:131`) and `cache.set` (`:247`). Wiring-only; no new abstraction (KISS).

### T2 — Child-process environment policy (#54)

codex's `ShellEnvironmentPolicy` is the reference model (`reference/codex/codex-rs/protocol/src/shell_environment.rs:46-149`):

- **Inherit modes (enum):** `All` (copy all parent env) · `Core` (whitelisted subset only) · `None` (empty).
- **6-step pipeline (order matters):** inherit-by-mode → default-exclude → custom-exclude →
  set-override → include_only filter → inject-thread-id. (`shell_environment.rs:46`)
- **Default-exclude patterns** (case-insensitive, unless `ignore_default_excludes`): `*KEY*`,
  `*SECRET*`, `*TOKEN*`. (`shell_environment.rs:80`)
- **Core vars always kept in `Core` mode:** `PATH, SHELL, TMPDIR, TEMP, TMP, HOME, LANG, LC_ALL,
  LC_CTYPE, LOGNAME, USER` (+ Windows set). (`shell_environment.rs:113`)

**OUR defect loci:** `packages/sdk/src/internal/runtime/lifecycle/spawn-collect.ts:33`
(`env: { ...process.env, ...options.env }` — full inherit, no exclude) and
`packages/sdk/src/sandbox/local-sandbox.ts:27` (spawns `/bin/sh -c` with inherited env; the class
doc claims "NOT a security boundary" but the API name "sandbox" implies one — honesty gap). MCP
stdio has the same pattern at `mcp/client.ts:130`.

**Fix model:** introduce a small stdlib env-policy helper (default mode = inherit-all-minus-secret-
excludes so existing behavior stays working but secrets are dropped; opt-in `Core`/allowlist for
true isolation). Apply it in `spawn-collect.ts` (the shared spawn wrapper — one fix covers hooks +
shell tool) and expose an `env` policy on `SandboxConfig`. Correct the `LocalSandbox` doc to state
plainly it provides NO OS isolation and only env-scrubbing + timeout (Rule 3 honesty). The `sh -c`
string exec is the sandbox's *documented contract* (it executes a shell command) — the security fix
is the env scrub + honest labeling, not removing `sh -c` (that would break the API); an arg-vector
variant is a separate opt-in, out of M0 scope.

### T3 — Pre-tool-call veto enforcement (#68) — CONFIRMED LIVE DEFECT

**Peer pattern (adk-js):** `runBeforeToolCallback` returns `Content | undefined`; a non-undefined
return short-circuits so the tool never runs (`reference/adk-js/core/src/plugins/plugin_manager.ts:276`).

**OUR dispatch is CORRECT:** `tool-dispatch.ts:190` calls `pluginManager.runPreToolCallHooks(...)`;
`:79` short-circuits on a non-undefined veto and returns a synthetic tool_result WITHOUT running the
tool. `PluginManager.runPreToolCallHooks` (`manager.ts:81`) returns the first decision whose
`block === true`. So the enforcement side works.

**The defect is the WIRING of the ACP plugin into the manager:**

1. `PluginManager` exposes **no `register()` method** — only `initialize(plugins)` (`manager.ts:52`),
   which is single-shot: it sets `#initialized = true` and **throws** "PluginManager.initialize
   called twice — register only once per process" on a second call (`manager.ts:53-54`).
2. The agent bootstrap already calls `this.pluginManagerCode.initialize(codePlugins)` during setup
   (`local-agent.ts:198`) — so by the time a prompt runs, the manager is initialized.
3. The ACP layer installs the permission plugin **per-prompt** (`prompt-handler.ts:98`, when
   `permissionMode !== "auto"`) via `installPermissionPlugin`, which does
   (`permission-plugin.ts:119-123`):
   ```ts
   if (typeof mgr.register === "function") { mgr.register(plugin); }
   else if (typeof mgr.initialize === "function") { void mgr.initialize([plugin]); }
   ```
   `register` does not exist → the `else` runs `void mgr.initialize([plugin])` → **throws
   "called twice"**, and the rejection is **swallowed by `void`**.
4. Net effect: the ACP `pre_tool_call` hook is **never aggregated** → `runPreToolCallHooks` returns
   `undefined` → **the guarded tool executes without the permission round-trip.** Live security
   defect #68.

**Fix model:** add a real `PluginManager.register(plugin)` (post-init single-plugin dispatch that
runs `#dispatchPlugin` + `#merge`, bypassing the single-shot guard) with **replace-by-plugin-name**
semantics so the per-prompt re-install (`installPermissionPlugin` is called every prompt) REPLACES
the prior `acp-permission-${sessionId}` handler instead of accumulating duplicates (the plugin's own
doc already promises "calling on the same agent twice replaces the prior listener"). Then
`installPermissionPlugin`'s existing `typeof mgr.register === "function"` branch works as authored.

---

## Cross-cutting Comparison

| Dimension | codex | adk-js | crewAI | mastra/opencode |
|---|---|---|---|---|
| Env isolation | `ShellEnvironmentPolicy` (All/Core/None + secret-excludes) `shell_environment.rs:46` | — | — | — |
| Veto enforcement | — | non-undefined before-callback short-circuits `plugin_manager.ts:276` | — | — |
| Tenant/scope key | — | prefix partitions `state.ts:12` | scope-path merge `memory_scope.py:38` | — |
| Timeout | AbortController `abort.test.ts:32` | — | stdlib `sleep+AbortSignal` `retry.ts:135` | opencode `setTimeout` `server.ts` |
| Security test shape | assert secret var absent `exec_env_tests.rs:38` | assert denied tool not run `plugin_manager_test.ts:207` | — | — |

## ADRs

### D1 — #56: thread tenantCtx into the cache calls (wiring-only)

**Decision:** Pass `{ namespace, userId, scope }` from `runActiveMemory` args to `cache.get`
(`active-memory.ts:131`) and `cache.set` (`:247`). No new abstraction.

**Rationale:** the collision-safe key infra already exists (`active-memory-cache.ts:97`), mirroring
crewAI's normalized scope-path and adk's explicit prefixes; the only gap is the dead wiring
(`no-stubs-no-mocks-no-wired.md §3`).

**Alternatives considered:** re-key by userId only (rejected — namespace + scope also partition;
NUL-separated tuple already handles it); a new TenantScopedCache wrapper (rejected — YAGNI, the arg
exists).

**Consequences:** two tenants with identical query text get isolated cache entries. Regression test:
two `runActiveMemory` calls, same `userText`, different `userId` → distinct results.

### D2 — #54: env-policy helper (secret-scrub default) + honest sandbox docs

**Decision:** Add a stdlib env-policy helper modeled on codex's inherit-mode + default-exclude
(`shell_environment.rs:46-149`); default = inherit-all-minus-secret-excludes (`*KEY*/*SECRET*/*TOKEN*`
+ common auth vars) so existing spawns keep working but secrets stop leaking; opt-in `Core`/allowlist
for stronger isolation. Apply in `spawn-collect.ts:33` (covers hooks + shell tool) and add an `env`
option to `SandboxConfig`. Rewrite `LocalSandbox`'s doc to state it provides NO OS isolation.

**Rationale:** codex proves the model; stdlib object-filter (parsimony rung 2). Fail-closed on
secrets by default (`error-handling.md`), honest labeling (Rule 3).

**Alternatives considered:** drop `sh -c` for arg-vector exec (rejected — breaks the documented
shell-command contract; separate opt-in); ship DockerSandbox now (rejected — out of M0 scope, XL).

**Consequences:** secret env vars no longer reach child processes by default. Regression test:
`FOO_SECRET` in parent → absent in spawned child env.

### D3 — #59: stdlib timeout + typed error + pending-map cleanup

**Decision:** stdio `request` wraps the pending Promise in a `setTimeout`-guarded race that rejects
a typed `NetworkError`/timeout error and deletes the `pending` map entry (`mcp/client.ts:184`);
HTTP `request` passes `AbortSignal.timeout(ms)` to `fetch` (`:217`). Configurable `timeoutMs`
(default e.g. 30s). Reconnect-after-drop is deferred to M2 (#59 remainder).

**Rationale:** peers use stdlib only (Corner 2); Node ≥22.12 has `AbortSignal.timeout`; a hung MCP
server must not block the loop forever (`error-handling.md` fail-fast).

**Alternatives considered:** `p-timeout` dep (rejected — parsimony); infinite wait (the current bug).

**Consequences:** a silent MCP server yields a typed timeout error instead of a hung agent.
Regression test: a stdio server that never replies → `request` rejects within `timeoutMs`, pending
map emptied (no leak).

### D4 — #68: real post-init `PluginManager.register(plugin)` with replace-by-name

**Decision:** Add `PluginManager.register(plugin): Promise<void>` — dispatches one plugin post-init
(runs `#dispatchPlugin` + `#merge`) WITHOUT the single-shot guard, and REPLACES any existing hooks
from a plugin of the same name (so per-prompt re-install is idempotent). `installPermissionPlugin`'s
`typeof mgr.register === "function"` branch then wires the ACP `pre_tool_call` veto correctly.

**Rationale:** dispatch already honors `{block:true}` (`tool-dispatch.ts:79`, mirrors adk
`plugin_manager.ts:276`); the ONLY gap is that the ACP plugin is never aggregated because `register`
is missing and `initialize` throws-when-re-called (swallowed by `void`). This is a live security
defect: guarded tools run unchecked.

**Alternatives considered:** install the permission plugin at `Agent.create` as a configured plugin
(rejected — ACP permission mode + conn are per-prompt/per-session, not known at create); relax
`initialize` to be multi-call (rejected — its single-shot guard is a legitimate invariant for the
bulk path; late single-plugin registration is a distinct, named operation).

**Consequences:** ACP `deny`/`ask` actually blocks tools. Regression test: install permission plugin
in `deny` mode on a real LocalAgent, dispatch a tool → tool handler never runs, veto message
surfaces. Also assert re-install replaces (no duplicate handlers).

## Recommendations for the project

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | #68 — add `PluginManager.register` (replace-by-name) + wire ACP veto; regression test tool-not-run | T3, D4, `no-stubs-no-mocks-no-wired.md`, `testing.md §4.1` | HIGH (live security) |
| 2 | #56 — thread tenantCtx into cache get/set; two-tenant isolation test | T1, D1, `no-stubs-no-mocks-no-wired.md` | HIGH (crit) |
| 3 | #54 — env-policy helper (secret-scrub) in spawn-collect + SandboxConfig.env; honest docs; secret-absent test | T2, D2, `error-handling.md`, `parsimony-ladder.md` | HIGH (crit) |
| 4 | #59 — stdlib timeout + typed error + pending cleanup (stdio) + AbortSignal.timeout (http); reject-within-timeout test | Corner 2, D3, `error-handling.md` | HIGH (crit) |

## Blocked questions (if any)

None — all 6 questions answered (Q1/Q2 merged into T1) with resolving citations.

## Halt-loop progress (audit trail)

- Iterations used: 1 (inline per-iteration contract; single deep-research pass via read-only Explore agent + direct dispatch reads)
- Questions answered: 6 / 6 (Q1+Q2 merged into T1)
- Questions blocked: 0
- Citations verified: peer + own-code, resolving on disk (verified post-write)
- Promise: BLUEPRINT_COMPLETE (all four halt conditions hold — every question answered, citations resolve, corners populated (Tools ADR-deferred), ≥1 ADR present)

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/m0-harness-security-floor-plan.md`
- Edge-case review: `.claude/knowledge-base/reviews/m0-harness-security-floor-edge-cases-2026-07-02.md`
- Confidence report: `.claude/knowledge-base/reviews/m0-harness-security-floor-confidence-2026-07-02.md` (by `/discover-confidence`)
- Project rules: `.claude/rules/architecture.md`, `.claude/rules/testing.md`, `.claude/rules/error-handling.md`, `.claude/rules/parsimony-ladder.md`, `.claude/rules/no-stubs-no-mocks-no-wired.md`
