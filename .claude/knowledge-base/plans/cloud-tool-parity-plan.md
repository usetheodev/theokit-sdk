# Plan: Cloud Tool Parity

> **Version 1.0** — Extend the cloud-agent contract-first pattern to all tool surfaces. When `Agent.create({ cloud: ... })` is called, the SDK validates at create-time which features are cloud-compatible, rejecting incompatible inline closures (`hooks` JS functions, `mcpServers.stdio` with local binaries, inline `tools[].handler`) with typed errors AND serializes the rest as a JSON payload contract that TheoPaaS will consume when it ships. Outcome: the same SDK code runs on Local runtime OR Cloud runtime; the rejection rules make the local→cloud trip explicit; the JSON contract is locked BEFORE PaaS ships so PaaS implements against a written spec, not a moving target.

## Context

### What exists today
- `LocalAgent` reads `.theokit/` from disk + executes shell/MCP stdio subprocesses + runs hook closures in-process. All tool surfaces work because they live in the same process.
- `CloudAgent` is an HTTP client. Today (pre-PaaS) it serves fixture responses for `send/stream/wait` and rejects `listArtifacts/downloadArtifact` for non-fixture keys (`cloud_runtime_pre_release` guard from the v1.0 work).
- The cloud-agent example demonstrates the SHAPE of the API for `cloud.repos` + `autoCreatePR` + artifacts. But the OTHER tool surfaces (memory, MCP, hooks, skills, plugins, subagents) aren't acknowledged by the cloud path — they're silently dropped when `cloud:` is set.

### The gap
Today a developer can pass `mcpServers: { my: { command: "/usr/local/bin/x" } }` together with `cloud: { ... }` and the SDK accepts it. At runtime, those mcpServers never make it to the cloud VM because (a) the binary is on the developer's disk, (b) PaaS doesn't even see the config. Silent drop. Same for `hooks: { preToolUse: async (ctx) => ... }` — the closure can't survive serialization to PaaS.

This violates the no-stubs-no-mocks-no-wired rule by analogy: a config option that LOOKS supported but silently drops is a "no-wired" feature.

### Evidence
- `packages/sdk/src/internal/runtime/cloud-agent.ts:64-93` — `send()` only forwards `message`, `mcpServers`, `systemPrompt` to `createCloudRun`. The `agentOptions.hooks/skills/plugins/agents/memory/context` fields are present in the construction but never serialized for the remote VM.
- `packages/sdk/src/internal/runtime/real-cloud-run.ts:139-145` — the HTTP POST body is just `{ message, mcpServers, systemPrompt }`. The rest of `agentOptions` is ignored.
- No validation rejects cloud-incompatible configurations at create-time.

### Why now
v1.1 PaaS work is approaching. The longer the SDK ships an ambiguous cloud contract, the more the PaaS team has to guess what the SDK expects. Locking the contract HOW the SDK serializes cloud config — and WHICH configs it rejects — gives PaaS a written spec to implement against. All work in this plan is pure-SDK (no PaaS dependency), so it ships before PaaS does.

## Objective

`Agent.create({ cloud: ... })` returns a `CloudAgent` whose serialized JSON contract is complete, validated, and committed to a contract test suite. Cloud-incompatible inline configurations (closure-based hooks, local-binary stdio MCP, inline tool handlers) are rejected at create-time with typed errors.

**Measurable goals:**
1. New `validateCloudToolParity(options)` rejects 6 specific cloud-incompatible patterns with 6 distinct error codes (D16).
2. New `serializeCloudAgentConfig(options)` produces a deterministic JSON payload covering all cloud-compatible features.
3. Golden test suite asserts the JSON shape for every supported feature (skills, plugins, hooks-as-rules, mcpServers.http, subagents, providers, memory.index, context).
4. `cloud-agent` example refactored to demonstrate `toolParity: true` mode + 3 new cloud-shape examples (`cloud-with-skills`, `cloud-with-mcp-http`, `cloud-with-subagents`) that fail fast on real keys without `THEOKIT_API_BASE_URL`.
5. Two new ADRs (D15 + D16) locked.
6. Zero regression in the existing v1.0 dogfood.
7. PaaS team has a written contract spec at `.claude/knowledge-base/specs/cloud-agent-payload.md` referencing the serializer + golden fixtures.

## ADRs

### D15 — Cloud tool parity is contract-validated, not silently degraded
**Decision:** When `cloud:` is set on `AgentOptions`, the SDK validates the rest of the config against a "what can survive the trip to PaaS?" rule set. Incompatible configurations throw typed `ConfigurationError`s at `Agent.create()` time. Compatible configurations are serialized to a canonical JSON payload that PaaS will consume.
**Rationale:** Silent drop is a no-wired violation. Either the feature is cloud-compatible (and we serialize it) or it isn't (and we reject it explicitly with a clear remediation message). No "looks supported but isn't" middle ground.
**Consequences:** Some configurations that work today on LocalAgent will throw when combined with `cloud:`. This is breaking behavior for users who were silently relying on the drop. Documented as a breaking note. Affected configurations are explicitly enumerated in D16.

### D16 — Six cloud-rejection error codes
**Decision:** The 6 rejection codes returned by `validateCloudToolParity`:

| Code | Rejects |
|---|---|
| `cloud_incompatible_hook_closure` | Hooks declared as JS closures (not rule arrays in `.theokit/hooks.json`) |
| `cloud_incompatible_tool_handler` | Inline `tools[].handler: (args) => ...` (must be MCP HTTP or named tool) |
| `cloud_incompatible_mcp_stdio_local` | `mcpServers.<name>.command` pointing at a local-FS path (`/usr/...`, `~/...`, `./...`, `../...`). Bare commands (`npx`, `node`, `uvx`, etc.) accepted — PaaS VM image guarantees common runtimes in PATH |
| `cloud_incompatible_local_cwd` | `local: { cwd }` set alongside `cloud:` (already caught — formalize the code) |
| `cloud_incompatible_function_resolver` | `systemPrompt: async (ctx) => ...` (function resolver instead of string) |
| `cloud_incompatible_memory_byo_runtime` | `Memory.runDreamingSweep({ embedding: { runtime } })` in cloud — runtime is BYO local-only |

**Rationale:** Six tight categories cover the realistic incompatibilities. Generic `cloud_invalid_config` would be unhelpful; per-category codes let users grep for the specific fix.
**Consequences:** Stable error code list. Adding a new incompatibility requires a new ADR + new code. Code list documented in `docs.md`.

## Dependency Graph

```
Phase 0 (validateCloudToolParity) ──┐
                                    │
Phase 1 (serializeCloudAgentConfig) ┤  (parallel-safe with Phase 0)
                                    │
                                    ▼
                             Phase 2 (CloudAgent wiring)
                                    │
                                    ▼
                             Phase 3 (Examples + spec doc)
                                    │
                                    ▼
                             Phase 4 (Dogfood QA)
```

Phase 0 + Phase 1 are independent and can run in parallel. Phase 2 consumes both. Phases 3-4 follow sequentially.

---

## Phase 0: `validateCloudToolParity` rejection function

### T0.1 — Pure-function validator with 6 typed errors

#### Objective
Add `packages/sdk/src/internal/runtime/cloud-tool-parity.ts` exporting `validateCloudToolParity(options: AgentOptions): void` that throws `ConfigurationError` with one of the 6 codes from D16 when it finds an incompatible config.

#### Evidence
- Today `cloud-agent.ts` does NOT inspect `options.hooks/mcpServers/tools/systemPrompt` for cloud-incompatibility.
- 6 categories were identified by walking the `AgentOptions` surface against "what can serialize to JSON for PaaS?" (see context).

#### Files to edit
```
packages/sdk/src/internal/runtime/cloud-tool-parity.ts — (NEW) validator
packages/sdk/src/agent.ts — call validator inside Agent.create when options.cloud is set
packages/sdk/tests/golden/agent/cloud-tool-parity.golden.test.ts — (NEW) 6+ tests
packages/sdk/CHANGELOG.md — entry under [Unreleased]
```

#### Deep file dependency analysis
- `cloud-tool-parity.ts` is a leaf module — only imports `ConfigurationError` and `AgentOptions` types. No runtime deps.
- `agent.ts:Agent.create` already validates options via `validateAgentOptions`. Add the cloud-parity call right after, gated on `options.cloud !== undefined`.
- The validator MUST run BEFORE `new CloudAgent(...)` so the error surfaces before any registry mutation.

#### Deep Dives
- **Closure detection**: `typeof options.hooks?.preToolUse === "function"` → reject. Allow array-of-rules (JSON-serializable shape).
- **Stdio MCP path detection (EC-3 fix — blacklist, not whitelist)**: parse `command` field; reject ONLY when it points to a local-FS path:
  ```ts
  function isLocalPath(cmd: string): boolean {
    return cmd.startsWith("/")
        || cmd.startsWith("~/")
        || cmd.startsWith("./")
        || cmd.startsWith("../");
  }
  ```
  Accept any bare command (`npx`, `pnpm`, `uvx`, `pipx`, `node`, `deno`, `bun`, `python`, `python3`, etc.) on the assumption that the PaaS VM image has common runtimes in PATH. This is critical: the whitelist approach rejected `npx` which is the canonical MCP install pattern (`{ command: "npx", args: ["-y", "@some/mcp-server"] }`). The PATH availability policy is part of D16's commitment.
- **Tool handler detection**: `Array.isArray(options.tools) && options.tools.some(t => typeof t.handler === "function")` → reject.
- **systemPrompt resolver**: `typeof options.systemPrompt === "function"` → reject.
- **Memory BYO runtime**: not on `AgentOptions` directly; this code lives on the `Memory.runDreamingSweep` API and is separate. Skip for this task; covered by a future `validateCloudDreaming`.
- **`local: { cwd }` + `cloud:`**: ALREADY rejected by `validateAgentOptions` for being mutually-exclusive. Just standardize the error `code` to `cloud_incompatible_local_cwd` to match D16.

#### Tasks
1. Create `cloud-tool-parity.ts` with the 5 in-scope rejection rules (memory BYO deferred to a sibling task).
2. Export `validateCloudToolParity(options: AgentOptions): void`.
3. Wire `Agent.create` to call it right after `validateAgentOptions` when `options.cloud !== undefined`.
4. **Standardize the existing `local + cloud` mutually-exclusive error code to `cloud_incompatible_local_cwd` (EC-5):** before editing, run `grep -rn "cloud_local_exclusive\|local_cloud_exclusive\|mutually_exclusive" packages/sdk/tests/ packages/sdk/src/` to list every consumer of the old code. Update them in the same commit. Add a CHANGELOG BREAKING note documenting the code rename.
5. Add 8 golden tests (one per code + one happy-path "all-rules-valid" + EC-4 hooks shape variants).
6. CHANGELOG entry.

#### TDD
```
RED:  reject-hook-closure (EC-4)            — options.hooks = { preToolUse: async (ctx) => {} } throws cloud_incompatible_hook_closure
RED:  accept-hook-rule-array (EC-4)         — options.hooks = { preToolUse: [{ command: "..." }] } passes (declarative)
RED:  reject-tool-handler                   — options.tools = [{ name, handler: () => 1 }] throws cloud_incompatible_tool_handler
RED:  reject-stdio-mcp-local-path-absolute  — options.mcpServers.x = { command: "/usr/local/bin/x" } throws cloud_incompatible_mcp_stdio_local
RED:  reject-stdio-mcp-local-path-home      — options.mcpServers.x = { command: "~/bin/x" } throws cloud_incompatible_mcp_stdio_local
RED:  reject-stdio-mcp-local-path-relative  — options.mcpServers.x = { command: "./bin/x" } throws cloud_incompatible_mcp_stdio_local
RED:  accept-stdio-mcp-bare-npx (EC-3)      — options.mcpServers.x = { command: "npx", args: ["-y", "@x/mcp"] } passes
RED:  accept-stdio-mcp-bare-uvx (EC-3)      — options.mcpServers.x = { command: "uvx", args: [...] } passes
RED:  reject-systemPrompt-function          — options.systemPrompt = async (ctx) => "..." throws cloud_incompatible_function_resolver
RED:  reject-local-cwd-with-cloud (EC-5)    — local: { cwd } + cloud: {} throws cloud_incompatible_local_cwd
RED:  accept-compatible-config              — all rules satisfied: no throw
GREEN: Implement validator + wire to Agent.create + migrate old error code
REFACTOR: Extract isLocalPath() + isHookClosure() helpers
VERIFY: pnpm --filter @usetheo/sdk test tests/golden/agent/cloud-tool-parity
```

#### Acceptance Criteria
- [ ] Validator file exists and exports a single function.
- [ ] 7+ test cases pass under Node 22.
- [ ] `Agent.create({ cloud: {...}, hooks: { preToolUse: async () => {} } })` throws `ConfigurationError(code: "cloud_incompatible_hook_closure")` with a message that names the field.
- [ ] No regression in existing `agent-resume`, `cloud-agent`, `cloud-prerelease-guard` tests.
- [ ] `pnpm validate` green.

#### DoD
- [ ] All tasks completed.
- [ ] `pnpm test` green.
- [ ] `pnpm typecheck` green.
- [ ] CHANGELOG entry references D15 + D16.

---

## Phase 1: `serializeCloudAgentConfig` payload serializer

### T1.1 — Canonical JSON serialization

#### Objective
Add `packages/sdk/src/internal/runtime/cloud-config-serializer.ts` exporting `serializeCloudAgentConfig(options: AgentOptions): CloudAgentPayload`. Output is a JSON-serializable object that PaaS will receive at `POST /v1/agents` and use to reconstruct the agent's tool catalog server-side.

#### Evidence
- Today `real-cloud-run.ts:139-145` only forwards `{ message, mcpServers, systemPrompt }`. Most of `agentOptions` is dropped silently.
- D15 says: compatible configs must serialize. This is the serializer.

#### Files to edit
```
packages/sdk/src/internal/runtime/cloud-config-serializer.ts — (NEW)
packages/sdk/src/internal/runtime/cloud-payload-types.ts — (NEW) the payload shape
packages/sdk/tests/golden/agent/cloud-payload.golden.test.ts — (NEW) snapshot tests
packages/sdk/tests/golden/agent/cloud-payload/ — (NEW dir) golden JSON fixtures
packages/sdk/CHANGELOG.md
```

#### Deep file dependency analysis
- `cloud-payload-types.ts` is a leaf — defines the `CloudAgentPayload` interface used by both the serializer and any future PaaS client.
- `cloud-config-serializer.ts` imports `cloud-payload-types.ts` and `AgentOptions`. Pure function, no I/O.
- Golden fixtures in `cloud-payload/*.json` are the LOCKED contract — PaaS reads these to know the shape it must accept.

#### Deep Dives
- **Payload shape (CloudAgentPayload):**
  ```ts
  interface CloudAgentPayload {
    schemaVersion: "1.0";
    cloud: { repos: Array<{ url: string; startingRef?: string }>; autoCreatePR?: boolean };
    model?: { id: string; params?: ModelParam[] };
    systemPrompt?: string;       // function resolvers rejected at validate-time
    skills?: { enabled: string[] };   // names only; PaaS resolves from cloned repo
    plugins?: { enabled: string[] };  // names only; PaaS resolves from cloned repo
    hooks?: HookRule[];          // declarative rule array; closures rejected
    mcpServers?: Record<string, HttpMcpConfig>; // HTTP only; stdio with local paths rejected
    agents?: Record<string, AgentDefinition>;   // subagents — pure config
    providers?: ProviderRoutingSettings;
    memory?: { enabled: boolean; index?: { backend: "sqlite-vec"; embedding?: { provider, model } } };
    context?: ContextSettings;
  }
  ```
  **schemaVersion note (EC-8):** locked at `"1.0"` for this release. There is no negotiation or backward-compat path with future v2 PaaS — if PaaS introduces v2, SDK must publish a matching minor. Documented as accepted risk; v2 work is a separate ADR.

- **Determinism (EC-1 fix — explicit canonicalize)**: standard `JSON.stringify` preserves insertion order, so two callers building `AgentOptions` in different field orders produce byte-different JSONs. Implement an explicit recursive `canonicalize(obj)` helper that sorts keys alphabetically before stringification. ~10 LoC:
  ```ts
  function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value !== null && typeof value === "object") {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value as object).sort()) {
        sorted[k] = canonicalize((value as Record<string, unknown>)[k]);
      }
      return sorted;
    }
    return value;
  }
  ```
  Test `serialize-key-order-independent` MUST verify that `serialize({ cloud, model })` and `serialize({ model, cloud })` produce byte-identical output.

- **Secrets allow-list per feature (EC-2 fix — explicit redaction)**: the serializer MUST NOT forward any field matching the patterns below. Building the payload uses an explicit allow-list per feature, never a structural `{ ...options }` spread:

  | Feature | Allowed fields | Stripped at all costs |
  |---|---|---|
  | `cloud` | `repos[].url`, `repos[].startingRef`, `autoCreatePR` | `apiKey`, anything else |
  | `mcpServers.<name>` (http) | `type`, `url`, `transport`, `headers.<safe-keys>` | `headers.Authorization`, `headers.x-api-key`, `env`, anything matching `/[Kk]ey$|[Tt]oken/` |
  | `providers.routes[]` | `provider`, `model`, `weight`, route metadata | `apiKey`, `clientSecret`, custom credentials |
  | `memory` | `enabled`, `index.backend`, `index.embedding.provider`, `index.embedding.model` | `index.embedding.apiKey` (PaaS provides creds) |
  | top-level | `model`, `name`, `systemPrompt` (string only), `agentId` | `apiKey` (lives in the bearer header, never payload body) |

  Add a test `serialize-strips-secrets` that constructs `AgentOptions` with secrets in every redactable field and asserts NONE appear in the resulting JSON.

- **Payload size guardrail (EC-7)**: serializer measures the byte length of the final stringified payload and emits a `stderr` warning when it exceeds 1 MB:
  ```ts
  if (Buffer.byteLength(json, "utf8") > 1_048_576) {
    process.stderr.write(`[theokit-sdk] cloud agent payload is ${size} bytes — large payloads may be rejected by PaaS\n`);
  }
  ```
  Not a hard limit; pure observability. Test `serialize-warns-on-large-payload`.

- **Edge cases:**
  - Empty `skills.enabled` array → omit the field entirely (not `[]`).
  - `cloud.repos` empty → reject upstream in validator (cloud agent without repo is meaningless).
  - `mcpServers` only HTTP transports — validate-time guarantees this.
  - `agentId` set on options → forwards to PaaS as part of the resume contract.

#### Tasks
1. Define `CloudAgentPayload` interface in `cloud-payload-types.ts`.
2. Implement `serializeCloudAgentConfig` with:
   - `canonicalize()` helper for deterministic key ordering (EC-1)
   - explicit allow-list per feature; secrets stripped (EC-2)
   - `Buffer.byteLength` measurement + stderr warning at >1 MB (EC-7)
   - `undefined`/empty-array drop
3. Write 11 golden tests: minimal-cloud, cloud-with-skills, cloud-with-plugins, cloud-with-hooks-rules, cloud-with-mcp-http, cloud-with-subagents, cloud-with-memory, cloud-with-providers, **`serialize-key-order-independent` (EC-1)**, **`serialize-strips-secrets` (EC-2)**, **`serialize-warns-on-large-payload` (EC-7)**. Each shape-test emits a golden JSON file under `tests/golden/agent/cloud-payload/`.
4. CHANGELOG entry referencing the allow-list per feature.

#### TDD
```
RED:  serialize-minimal-cloud                       — { cloud: { repos: [{url}] } } → expected golden JSON
RED:  serialize-cloud-with-skills                   — skills.enabled = ["deploy"] → JSON has skills.enabled = ["deploy"]
RED:  serialize-cloud-with-hooks-rules              — hooks (rule array) → JSON has hooks key
RED:  serialize-cloud-with-mcp-http                 — mcpServers HTTP entry → JSON preserves url/type
RED:  serialize-cloud-with-subagents                — agents map → JSON preserves it
RED:  serialize-deterministic                       — same input twice → byte-identical JSON
RED:  serialize-key-order-independent (EC-1)        — serialize({cloud, model}) === serialize({model, cloud}) byte-for-byte
RED:  serialize-drops-undefined                     — omit `name` field absent in options → JSON has no `name` key
RED:  serialize-omits-empty-arrays                  — skills.enabled = [] → JSON has no skills key
RED:  serialize-strips-secrets (EC-2)               — apiKey + mcp.headers.Authorization + providers.routes[].apiKey absent from output
RED:  serialize-strips-mcp-env                      — mcpServers.x.env = { TOKEN: "real" } → JSON has no env key
RED:  serialize-warns-on-large-payload (EC-7)       — payload >1 MB triggers stderr warning (no throw)
GREEN: Implement serializer + canonicalize() + per-feature allow-lists + size-warning + 8 shape fixtures
REFACTOR: Extract per-feature serializers (serializeHooks, serializeMcp, etc.) for readability
VERIFY: pnpm --filter @usetheo/sdk test tests/golden/agent/cloud-payload
```

#### Acceptance Criteria
- [ ] `cloud-config-serializer.ts` exports a pure function.
- [ ] 8 golden fixtures under `tests/golden/agent/cloud-payload/`.
- [ ] Two consecutive calls with identical input produce byte-identical JSON.
- [ ] Empty arrays and undefined fields are omitted (no `"skills": []` or `"name": null` in output).

#### DoD
- [ ] All tasks completed.
- [ ] `pnpm test` green.
- [ ] `pnpm typecheck` green.

---

## Phase 2: Wire validator + serializer into CloudAgent

### T2.1 — Threading the validated payload through CloudAgent.send + createRealCloudRun

#### Objective
When `Agent.create({ cloud: ... })` runs: (a) `validateCloudToolParity` rejects bad configs, (b) `serializeCloudAgentConfig` produces the payload, (c) the payload is forwarded to `createRealCloudRun` so the HTTP POST body contains the full agent shape, not just `{message, mcpServers, systemPrompt}`.

#### Evidence
- `real-cloud-run.ts:139-145` HTTP body is currently `{ message, mcpServers, systemPrompt }`.
- The serializer from Phase 1 produces the full shape; CloudAgent must thread it through.

#### Files to edit
```
packages/sdk/src/internal/runtime/cloud-agent.ts — call validator at construct, hold payload
packages/sdk/src/internal/runtime/real-cloud-run.ts — accept payload, embed in POST body
packages/sdk/src/internal/runtime/cloud-run.ts — fixture path also receives payload (echoes back for tests)
packages/sdk/tests/golden/agent/cloud-agent-payload-wiring.golden.test.ts — (NEW)
```

#### Deep file dependency analysis
- `cloud-agent.ts` is the integration point. The validator + serializer run there; the resulting payload is held on the instance for both `createRealCloudRun` and `createCloudRun` paths.
- `real-cloud-run.ts` HTTP body changes from `{ message, mcpServers, systemPrompt }` to `{ message, agentConfig: <payload>, mcpServers, systemPrompt }`. Backward compat: PaaS can ignore `agentConfig` until it implements it; the SDK ships the field today.
- Fixture path (`cloud-run.ts`) echoes the payload in its synthetic events so contract tests can assert on it.

#### Deep Dives
- **Layering**: `validateCloudToolParity` runs in `Agent.create`, NOT in `CloudAgent.constructor`, so that `Agent.create({ cloud, ... })` is the only entry point that performs the check. Direct callers of `new CloudAgent(...)` are internal-only and trusted.
- **Caching**: serialize once at construct time, hold on `this.cloudPayload`. Re-serialize ONLY when `agent.reload()` is called (filesystem-derived skills/plugins may have changed).
- **Edge case**: when `useRealRuntime` is false (fixture mode), the payload still gets serialized — it's the contract surface. The fixture responder echoes it back so tests can assert "what would PaaS see?".

#### Tasks
1. Add `cloudPayload: CloudAgentPayload` field on `CloudAgent`.
2. Call `serializeCloudAgentConfig` at the end of the constructor (after validator succeeds).
3. Update `createRealCloudRun` signature to accept `agentConfig: CloudAgentPayload` and embed in POST body.
4. Update `createCloudRun` fixture path to accept the payload (for echo back).
5. Add `agent.reload()` re-serialization.
6. Add `cloud-agent-payload-wiring` golden test (3+ cases).

#### TDD
```
RED:  cloud-agent-holds-payload                       — after Agent.create, agent.cloudPayload is the serialized shape
RED:  real-cloud-run-posts-agentConfig                — stub fetch captures POST body; body.agentConfig matches payload
RED:  fixture-cloud-run-echoes-payload                — fixture mode emits a "config" event carrying the payload (for contract tests)
RED:  reload-repopulates-from-filesystem (EC-6)       — write .theokit/skills/new/SKILL.md to cwd after Agent.create; call agent.reload(); assert agent.cloudPayload.skills.enabled now includes "new". Asserts the full reload chain: re-read FS → update in-memory skills list → re-serialize.
GREEN: Wire validator + serializer + payload threading + reload chain
REFACTOR: None expected
VERIFY: pnpm --filter @usetheo/sdk test tests/golden/agent/cloud-agent-payload-wiring
```

#### Acceptance Criteria
- [ ] `agent.cloudPayload` field exists and matches `serializeCloudAgentConfig(options)`.
- [ ] HTTP POST body in `createRealCloudRun` includes `agentConfig`.
- [ ] Fixture mode echoes the payload (verified via golden test).
- [ ] `agent.reload()` re-serializes when filesystem-derived state changes.
- [ ] All v1.0 tests stay green (cloud-prerelease-guard, agent-management, etc.).

#### DoD
- [ ] All tasks completed.
- [ ] `pnpm test` green (target: 220+ tests after the additions).
- [ ] `pnpm validate` green.

---

## Phase 3: Examples + spec doc for PaaS team

### T3.1 — Three new cloud examples + 1 spec doc

#### Objective
Concrete examples consumers can copy. PaaS team has a written reference for the payload shape.

#### Evidence
- Today's `cloud-agent` example shows ONLY repos + autoCreatePR + artifacts. It doesn't demonstrate the tool-parity story.
- PaaS team has nothing in `.claude/knowledge-base/specs/` to point at.

#### Files to edit
```
examples/cloud-with-skills/ — (NEW) cloud + skills.enabled = ["deploy", "review"]
examples/cloud-with-mcp-http/ — (NEW) cloud + HTTP MCP server
examples/cloud-with-subagents/ — (NEW) cloud + agents map
examples/README.md — add 3 new entries
.claude/knowledge-base/specs/cloud-agent-payload.md — (NEW) PaaS-facing spec
```

#### Deep file dependency analysis
- Each example follows the pattern of `cloud-agent`: fixture-mode by default, swap `.env` to hit real PaaS.
- Examples import the new payload type so they double as compile-time contract checks.
- Spec doc references the golden fixtures (paths) as the canonical shape, so PaaS team can grep the test directory for ground truth.

#### Deep Dives
- **`cloud-with-skills`**: declares `skills: { enabled: ["deploy"] }`, sets up a `.theokit/skills/deploy/SKILL.md` in the example's `cwd` (which IS uploaded as part of the repo when PaaS clones — but for fixture, just echoed in the event stream).
- **`cloud-with-mcp-http`**: declares `mcpServers: { search: { type: "http", url: "https://mcp.example.com" } }`. Demonstrates the HTTP-only constraint for cloud. **README MUST include a note (EC-9)**: "The URL is a placeholder for documentation. Replace with your real MCP HTTP server endpoint before running in production. In fixture mode (`theo_test_*` keys) the SDK does not actually call the URL; the example only validates that the SDK accepts the config shape."
- **`cloud-with-subagents`**: declares `agents: { reviewer: { ... } }` inline. Pure config; demonstrates subagent parity.
- **Spec doc structure**: schema version + payload TypeScript interface + per-feature serialization examples + rejection codes table + 3 example payloads (minimal, full, edge-case).

#### Tasks
1. Scaffold 3 example directories (package.json, tsconfig.json, src/index.ts, README.md, .env.example, .gitignore).
2. Each example: validate-compile-run path; check `agent.cloudPayload` matches a per-example fixture.
3. Update `examples/README.md` inventory section.
4. Write `cloud-agent-payload.md` spec.

#### TDD
```
RED:  cloud-with-skills-example-builds          — `pnpm --filter ./examples/cloud-with-skills build` succeeds
RED:  cloud-with-mcp-http-example-builds        — same
RED:  cloud-with-subagents-example-builds       — same
RED:  spec-doc-references-golden                 — `cloud-agent-payload.md` contains exact paths to golden JSONs
GREEN: Write examples + spec
REFACTOR: None expected
VERIFY: For each example: `cd examples/<name> && pnpm install --ignore-workspace && pnpm dev` succeeds in fixture mode
```

#### Acceptance Criteria
- [ ] 3 new example directories with running `pnpm dev` (fixture mode).
- [ ] `examples/README.md` lists all 3 with the cloud-shape badge.
- [ ] Spec doc exists with payload interface + rejection table + 3 example payloads.
- [ ] All 3 examples use the new `cloudPayload` field to print "what PaaS would receive".

#### DoD
- [ ] All tasks completed.
- [ ] All 3 examples run green in fixture mode.
- [ ] Spec doc is internally linkable from CHANGELOG.

---

## Phase 4: Dogfood QA (MANDATORY)

**Objective:** Validate that the new validator + serializer + examples work end-to-end as a real user would experience them.

### Execution
1. `nvm use` (Node 22.12+).
2. `pnpm install && pnpm validate` — all green.
3. Run the 5 existing memory dogfood examples — no regression.
4. Run each of the 3 new cloud examples in fixture mode — all `pnpm dev` succeed.
5. Sanity test: write a script that calls `Agent.create` with each of the 6 rejection patterns and verifies the error code.

### Acceptance Criteria
- [ ] `pnpm validate` exits 0 (test count ≥220).
- [ ] 5/5 existing memory examples pass under Node 22.
- [ ] 3/3 new cloud examples run successfully in fixture mode.
- [ ] 6/6 rejection patterns produce the expected error code.

### If Dogfood Fails
1. Bisect: regression in validator, serializer, or wiring?
2. Fix the failing phase before declaring complete.
3. Re-run.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Cloud options silently drop hook closures | T0.1 | `cloud_incompatible_hook_closure` rejection |
| 2 | Cloud options silently drop inline tool handlers | T0.1 | `cloud_incompatible_tool_handler` rejection |
| 3 | Cloud options silently drop stdio MCP with local paths | T0.1 | `cloud_incompatible_mcp_stdio_local` rejection |
| 4 | Cloud options silently drop function-resolver systemPrompt | T0.1 | `cloud_incompatible_function_resolver` rejection |
| 5 | `local: { cwd }` rejection lacks canonical error code | T0.1 | Standardize to `cloud_incompatible_local_cwd` |
| 6 | No canonical payload shape for PaaS to consume | T1.1 | `serializeCloudAgentConfig` + 8 goldens |
| 7 | `real-cloud-run` POST body misses skills/plugins/hooks/etc. | T2.1 | Embed `agentConfig` in body |
| 8 | Fixture path doesn't echo payload (contract testing impossible) | T2.1 | Fixture emits "config" event |
| 9 | No example demonstrates cloud + skills | T3.1 | `examples/cloud-with-skills` |
| 10 | No example demonstrates cloud + MCP HTTP | T3.1 | `examples/cloud-with-mcp-http` |
| 11 | No example demonstrates cloud + subagents | T3.1 | `examples/cloud-with-subagents` |
| 12 | PaaS team has no written contract reference | T3.1 | `.claude/knowledge-base/specs/cloud-agent-payload.md` |
| 13 | (EC-1) Serializer key order non-deterministic | T1.1 | `canonicalize()` helper + `serialize-key-order-independent` test |
| 14 | (EC-2) Serializer leaks secrets (apiKey, mcp headers, env, route credentials) | T1.1 | Per-feature allow-list + `serialize-strips-secrets` test |
| 15 | (EC-3) MCP whitelist rejects `npx` and other canonical install patterns | T0.1 | Switch to local-path blacklist (`/`, `~/`, `./`, `../`) — bare commands accepted |
| 16 | (EC-4) Hooks rule-array vs function shape not differentiated in tests | T0.1 | `accept-hook-rule-array` + `reject-hook-closure` paired tests |
| 17 | (EC-5) Existing `local + cloud` error code rename may break consumers | T0.1 | Pre-edit grep for old code + same-commit migration + CHANGELOG note |
| 18 | (EC-6) `agent.reload()` may not re-read filesystem skills/plugins | T2.1 | `reload-repopulates-from-filesystem` test asserts full chain |
| 19 | (EC-7) Payload size unbounded; large `agents` map may exceed PaaS limit | T1.1 | `Buffer.byteLength` measurement + stderr warning at >1 MB |
| 20 | (EC-8) `schemaVersion` locked at "1.0" without v2 negotiation | T1.1 | Documented as accepted risk in Deep Dives |
| 21 | (EC-9) `cloud-with-mcp-http` example URL is fake | T3.1 | README placeholder note |

**Coverage: 21/21 gaps covered (100%)**

## Global Definition of Done

- [ ] All 4 phases completed.
- [ ] `pnpm test` green (≥220 tests).
- [ ] `pnpm validate` green (publint + attw + quality all clean).
- [ ] `pnpm quality:dead` (full knip) green.
- [ ] ADRs D15 + D16 in `.claude/knowledge-base/adrs/`.
- [ ] CLAUDE.md Decided ADRs table updated.
- [ ] 6 rejection error codes documented in `docs.md` under a new "Cloud tool parity" section.
- [ ] Spec doc + 8 golden payloads exist for PaaS to consume.
- [ ] CHANGELOG entry under `[Unreleased]`.

## Final Phase: Dogfood QA (MANDATORY)

Specified above as Phase 4.

### Acceptance Criteria
- [ ] Health score ≥70/100.
- [ ] Zero CRITICAL issues introduced.
- [ ] Zero HIGH issues in cloud-path features.

### If Dogfood Fails
1. Bisect.
2. Fix.
3. Re-run.
