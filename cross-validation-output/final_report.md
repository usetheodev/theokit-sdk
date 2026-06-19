# Cross-Validation Report — `@theokit/sdk` vs `peer-js` (Google ADK for JS)

**Engagement:** loop-cross-validation
**Date:** 2026-06-19
**Scope:** Agent-SDK surface — `packages/**` (target) vs `core/` + `dev/` (reference)
**Focus:** all dimensions (no `--focus` set)

---

## Executive summary

This report cross-validates **`@theokit/sdk`** (the Harness pillar of Theo — a multi-provider TypeScript agent harness, ~46k LOC kernel) against **`peer-js`** (Google's Agent Development Kit ported to JS/TS, ~89k LOC), used as the gold-standard reference. Methodology: full file inventory of both trees, 17 component pairs mapped, 14 weighted comparison dimensions defined, code-level scoring (0-5) grounded in direct reads of both codebases, gap detection with grep-verified absences, and a consistency cross-check of scores against detected gaps. The target matches or beats the reference on developer-facing quality (typed errors, DX, tooling, provider breadth) but trails on enterprise/runtime surfaces the reference inherits from Google Cloud (delegated auth, relational sessions, conformance testing, declarative multi-agent topologies).

**Overall Score: 3.75 / 5.0** (weighted; 75.0%)

**Top 3 gaps:**

1. **[high]** No OAuth2/OIDC credential exchange + refresh for tool/integration auth (`core/src/auth/auth_handler.ts:19`)
2. **[high]** No policy-engine security plugin to gate tool calls with allow/deny + human confirmation (`core/src/plugins/security_plugin.ts:88`)
3. **[high]** No relational/ORM-backed (multi-DB) session persistence (`core/src/sessions/database_session_service.ts:66`)

---

## Score card

| Dimension | Category | Score | Reference file | Summary |
|---|---|---|---|---|
| Error Handling | error_handling | 5.0/5 | `core/src/auth/exchanger/base_credential_exchanger.ts:13` | Target leads: typed hierarchy + isRetryable + closed union vs plain-Error/event-data |
| API Design & DX | api_design | 4.5/5 | `core/src/runner/runner.ts:123` | Target leads: façade/builder/factory + one-shot prompt vs explicit DI |
| Build & Tooling | devops | 4.5/5 | `peer-js/.release-please-manifest.json` | Target leads: biome/tsup-dual/native-ABI preflight |
| Folder Organization & Layering | architecture | 4.0/5 | `core/src` | On par — both package-by-feature |
| Design Patterns | design_patterns | 4.0/5 | `core/src/agents/llm_agent.ts:80` | On par — ref broader catalog (CoR processor pipeline) |
| Provider / Model Abstraction | api_design | 4.0/5 | `core/src/models/registry.ts:58` | Target broader breadth; ref has live bidirectional + regex registry |
| Observability & Telemetry | observability | 4.0/5 | `core/src/telemetry/tracing.ts` | Comparable; ref uses gen_ai semconv |
| Modularity & Code Organization | code_organization | 4.0/5 | `core/src/utils` | On par — no god modules either side |
| Dependency Injection & Extensibility | architecture | 3.5/5 | `core/src/models/registry.ts:58` | Ref registry more open for backends |
| Streaming & Concurrency Model | performance | 3.5/5 | `core/src/models/base_llm.ts:36` | Ref has live bidirectional connections |
| Testing Strategy | testing | 3.0/5 | `peer-js/vitest.config.ts` | Ref stronger: conformance/e2e/86-88% gates |
| Session & State Persistence | architecture | 3.0/5 | `core/src/sessions/database_session_service.ts:66` | Ref multi-DB; target has durability prims |
| Agent Composition | design_patterns | 3.0/5 | `core/src/agents/sequential_agent.ts:41` | Ref typed composite agents + agent-as-tool |
| Security & Auth | security | 2.5/5 | `core/src/auth/auth_handler.ts:19` | Ref much stronger: full OAuth2/OIDC subsystem |

**Weighted Average: 3.75 / 5.0** (∑ weight·score / ∑ weight = 63.75 / 17.0)
**Simple Average: 3.79 / 5.0**

### Score distribution

```
5 ██████████  Error Handling
4.5 █████████░ API Design & DX · Build & Tooling
4 ████████░░  Folder Org · Design Patterns · Provider · Observability · Modularity
3.5 ███████░░░ DI & Extensibility · Streaming & Concurrency
3 ██████░░░░  Testing · Sessions · Agent Composition
2.5 █████░░░░░ Security & Auth
```

---

## Gap analysis

### High gaps

| # | Gap | Type | Reference file | Suggestion |
|---|---|---|---|---|
| 1 | OAuth2/OIDC credential exchange + refresh | missing_feature | `core/src/auth/auth_handler.ts:19` | Port exchanger/refresher/registry shape |
| 2 | Policy-engine security plugin (allow/deny + confirmation) | missing_safeguard | `core/src/plugins/security_plugin.ts:88` | Ship built-in policy plugin on existing veto |
| 3 | Relational/ORM session persistence (multi-DB) | missing_feature | `core/src/sessions/database_session_service.ts:66` | DB-backed store atop existing sqlite primitives |
| 4 | Conformance/integration/e2e tiers green-gated | missing_test | `peer-js/vitest.config.ts` | Promote contract/golden out of RED-excluded |

#### Gap #1 — OAuth2/OIDC credential exchange + refresh
- **Type:** `missing_feature` · **Severity:** high
- **Reference:** `core/src/auth/auth_handler.ts:19` — `export class AuthHandler {` (orchestrates BaseAuthProvider + exchangers + refreshers + registries; `ToolAuthHandler` applies OpenAPI security schemes)
- **What's missing in target:** only per-provider API keys + `./server/auth` adapters; no authorization-code/client-credentials exchange or token refresh.
- **Where to implement:** `packages/sdk/src/internal/auth` (new) + `./server/auth`
- **Suggestion:** start from `core/src/auth/exchanger/base_credential_exchanger.ts:13` (`CredentialExchangeError`) and the handler at `:19`. Enables agents to call OAuth2-protected tools/APIs.
- **Effort:** high

#### Gap #2 — Policy-engine security plugin
- **Type:** `missing_safeguard` · **Severity:** high
- **Reference:** `core/src/plugins/security_plugin.ts:88` — `export class SecurityPlugin extends BasePlugin {` (backed by `BasePolicyEngine`/`InMemoryPolicyEngine` at `:56`/`:67`; injects request-confirmation function call)
- **What's missing in target:** a `pre_tool_call` veto hook exists, but no built-in policy engine or human-in-the-loop confirmation primitive.
- **Where to implement:** `packages/sdk/src/internal/plugins` (ship a built-in policy plugin)
- **Suggestion:** build a policy/confirmation plugin on top of the existing veto. See `security_plugin.ts:56-89`.
- **Effort:** medium

#### Gap #3 — Relational/ORM session persistence
- **Type:** `missing_feature` · **Severity:** high
- **Reference:** `core/src/sessions/database_session_service.ts:66` — `export class DatabaseSessionService extends BaseSessionService {` (MikroORM over PG/MySQL/SQLite/MariaDB; URI registry)
- **What's missing in target:** conversations persist to in-memory/fs JSON only; no relational store for multi-tenant deployments.
- **Where to implement:** `packages/sdk/src/internal/persistence`
- **Suggestion:** add a DB-backed store — the target already has `sqlite-cas.ts`/`sqlite-wal.ts`/`atomic-write.ts`/`file-lock.ts` primitives to build on. See reference `:66-97` + `registry.ts`.
- **Effort:** high

#### Gap #4 — Green-gated test tiers
- **Type:** `missing_test` · **Severity:** high
- **Reference:** `peer-js/vitest.config.ts` — unit/integration/e2e/cross-language project suites (Java/Python ADK parity), 86-88% coverage.
- **What's missing in target:** `tests/contract/**` + golden suites excluded from default `pnpm test` (RED roadmap); soft 80/75 coverage. Public contract not gate-enforced.
- **Where to implement:** `packages/sdk/vitest.config.ts:70` (exclude block)
- **Suggestion:** promote contract/golden out of RED-excluded state; add an integration tier; consider an SDK conformance suite inspired by `tests/cross_language/`.
- **Effort:** medium

### Medium gaps

| # | Gap | Reference file |
|---|---|---|
| 5 | Artifact (file output) service with versioning | `core/src/artifacts/base_artifact_service.ts:105` |
| 6 | Typed composite-agent primitives (Sequential/Parallel/Loop/Routed) | `core/src/agents/sequential_agent.ts:41` |
| 7 | Agent-as-tool (AgentTool) | `core/src/tools/agent_tool.ts` |
| 8 | Pluggable context-compaction strategy interface | `core/src/context/base_context_compactor.ts:12` |
| 9 | Structured code-executor with retry (Python/JS) | `core/src/code_executors/base_code_executor.ts:50` |

### Low gaps

| # | Gap | Reference file |
|---|---|---|
| 10 | gen_ai OTEL semantic conventions on spans | `core/src/telemetry/tracing.ts` |
| 11 | Open public model/provider registration hook (by regex) | `core/src/models/registry.ts:91` |

---

## Detailed comparisons by dimension

### Error Handling — 5.0/5 (error_handling)
- **Target:** `packages/sdk/src/errors.ts:142` — `TheokitAgentError` + 7 typed subclasses, `isRetryable`, `ErrorMetadata`, closed `KnownAgentRunErrorCode`; per-provider error-mappers.
- **Reference:** `core/src/auth/exchanger/base_credential_exchanger.ts:13` — mostly plain `Error`; failures as event data; only 2 custom errors.
- **Analysis:** target is materially stronger — exhaustive typed taxonomy with retry semantics. Reference's event-data model is intentional for stream resilience but loses static typing.
- **Suggestion:** keep the taxonomy; optionally add an error-as-event-data path for non-fatal tool failures.

### Security & Auth — 2.5/5 (security)
- **Target:** `packages/sdk/src/server/auth` — API keys + path-safety + secret redaction + sandbox + credential-pool-store; no delegated-auth flows.
- **Reference:** `core/src/auth/auth_handler.ts:19` — full OAuth2/OIDC: exchangers, refreshers, registries, `ToolAuthHandler` from OpenAPI security.
- **Analysis:** reference is substantially deeper on the auth dimension; target covers API-key auth + strong secret/path hygiene only.
- **Suggestion:** port the exchanger/refresher/registry shape if tool/integration auth beyond API keys is in scope.

### Testing Strategy — 3.0/5 (testing)
- **Target:** `packages/sdk/vitest.config.ts:70` — forks pool, soft 80/75, contract/golden excluded (RED roadmap).
- **Reference:** `peer-js/vitest.config.ts` — unit/integration/e2e/cross-language suites, 86-88%.
- **Analysis:** reference's pyramid is more complete and harder-gated; target's contract layer is green-excluded by default.
- **Suggestion:** promote contract/golden suites; add an integration tier; mirror cross-language conformance for API parity.

### Session & State Persistence — 3.0/5 (architecture)
- **Target:** `internal/persistence/conversation-storage-fs.ts` — fs/memory JSON + strong durability primitives (WAL fallback, CAS, atomic-write, file-lock).
- **Reference:** `core/src/sessions/database_session_service.ts:66` — MikroORM multi-DB + VertexAi + URI registry.
- **Analysis:** different focus — reference offers production relational persistence; target offers excellent file-level durability but no relational store.
- **Suggestion:** add a DB-backed session/conversation store on the existing sqlite primitives.

### Agent Composition — 3.0/5 (design_patterns)
- **Target:** `packages/sdk-handoff/src` — handoff plugin + markdown subagents; imperative composition.
- **Reference:** `core/src/agents/sequential_agent.ts:41` — typed Sequential/Parallel/Loop/Routed + AgentTool.
- **Analysis:** reference provides declarative typed multi-agent topologies; target composes imperatively.
- **Suggestion:** add typed composite-agent primitives alongside handoff.

*(Full per-dimension comparisons with both-project evidence are persisted in the DB `comparisons` table and summarized in `analysis/deep_analysis.md`. DI & Extensibility 3.5, Streaming 3.5, Folder Org 4.0, Design Patterns 4.0, Provider 4.0, Observability 4.0, Modularity 4.0, API/DX 4.5, Build 4.5 — each cites target_file + reference_file.)*

---

## Where target excels

| Area | Target approach | Reference approach | Verdict |
|---|---|---|---|
| Error model | Typed hierarchy + isRetryable + closed `KnownAgentRunErrorCode` union (`errors.ts:142`) | Plain `Error` + failures as event data | Target better — static typing of failure modes + retry semantics |
| Provider breadth | Anthropic/OpenAI/OpenRouter/Ollama/LMStudio/Gemini in-box (`internal/llm/clients/*`) | Gemini-first (vertex/genai) | Target better — multi-provider out of the box |
| Native bindings | ABI preflight (ADR D01) + publint/attw dual-format validation | No equivalent guard | Target better — prevents `NODE_MODULE_VERSION` crashes |
| DX / quick start | `Agent.prompt` one-shot + façade/builder/factory (`agent.ts:64`) | Explicit `Runner` DI wiring (`runner.ts:123`) | Target better for onboarding; reference more explicit |

---

## Improvement roadmap

| Priority | Action | Gap/Finding | Effort | Impact | Reference file |
|---|---|---|---|---|---|
| 1 | Ship a built-in policy/confirmation plugin atop the `pre_tool_call` veto | Gap #2 | medium | high | `core/src/plugins/security_plugin.ts:88` |
| 2 | Promote contract/golden tests out of RED-excluded; add integration tier | Gap #4 | medium | high | `peer-js/vitest.config.ts` |
| 3 | Add DB-backed session/conversation store on existing sqlite primitives | Gap #3 | high | high | `core/src/sessions/database_session_service.ts:66` |
| 4 | Add OAuth2/OIDC credential exchange + refresh subsystem | Gap #1 | high | high | `core/src/auth/auth_handler.ts:19` |
| 5 | Add typed composite-agent primitives (sequential/parallel/loop) + agent-as-tool | Gaps #6,#7 | medium | medium | `core/src/agents/sequential_agent.ts:41` |
| 6 | Extract a pluggable context-compaction strategy interface | Gap #8 | low | medium | `core/src/context/base_context_compactor.ts:12` |
| 7 | Add an artifact service with versioning | Gap #5 | medium | medium | `core/src/artifacts/base_artifact_service.ts:105` |
| 8 | Add a structured code-executor with retry over the sandbox | Gap #9 | medium | medium | `core/src/code_executors/base_code_executor.ts:50` |
| 9 | Expose a public provider-registration hook (regex → client) | Gap #11 | low | medium | `core/src/models/registry.ts:91` |
| 10 | Adopt gen_ai OTEL semantic-convention span attributes | Gap #10 | low | low | `core/src/telemetry/tracing.ts` |

---

## What was NOT analyzed

- **Runtime behavior** — all scoring is static. No agent was actually run against a live LLM in either project; live streaming, Gemini Live bidirectional connections, and retry-under-failure were assessed by reading code, not executing.
- **Reference dev/ server + CLI depth** — `dev/` (AdkApiServer, deploy-cloud-run/agent-engine, graphviz agent DAG) was mapped but not deeply scored; the target's `@theokit/cli` + `@theokit/acp` were likewise only surface-mapped.
- **Target subsystems given light treatment** — `sdk-cache` (semantic cache), `sdk-budget` (USD tracking), and `codemod-sdk-2-0` have no reference counterpart, so they are unscored rather than scored 0 (no comparison basis).
- **GCP-specific reference surface** — VertexAI/Apigee/Agent Registry/GCS artifacts are Google-cloud-coupled; a like-for-like target comparison is not meaningful (target is provider-neutral by design).
- **Test execution** — coverage numbers are read from config, not re-measured.
- **Cross-language conformance** — reference aligns with Java/Python ADK; target has no multi-language sibling, so that axis is one-directional.

---

## Appendix

### Project profiles

| Attribute | Target | Reference |
|---|---|---|
| Path | `@theokit/sdk` (`packages/**`) | `peer-js` (`core/` + `dev/`) |
| Language | TypeScript | TypeScript |
| Framework | pnpm monorepo · tsup · vitest · biome | npm monorepo · esbuild/tsc · vitest · gts |
| LOC (kernel) | ~45,958 | ~89,216 (full repo) |
| Files (inventoried) | 1,116 | 364 |
| Component pairs | 17 mapped (34 rows) | — |

### Database counts

| Table | Rows |
|---|---|
| project_info | 2 |
| files_inventoried | 1480 |
| components | 34 |
| dimensions | 14 |
| comparisons | 14 |
| gaps | 11 |
| findings | 15 |
| reference_files | 11 |
| quality_gates | 4 |

### Quality gate history

| Phase | Iteration | Score | Status | Evaluator |
|---|---|---|---|---|
| 2 (structure_compare) | 2 | 0.90 | passed | structure-comparator |
| 3 (deep_analysis) | 3 | 0.92 | passed | implementation-analyst |
| 4 (gap_detection) | 4 | 0.91 | passed | gap-detector |
| 5 (scoring) | 5 | 0.93 | passed | scoring-analyst |

### Most-cited reference files

| File | Purpose |
|---|---|
| `core/src/models/registry.ts` | LLMRegistry — regex-match + open registration |
| `core/src/auth/auth_handler.ts` | Full OAuth2/OIDC auth orchestration |
| `core/src/sessions/database_session_service.ts` | Multi-DB session persistence (MikroORM) |
| `core/src/agents/sequential_agent.ts` | Typed composite agents |
| `peer-js/vitest.config.ts` | Conformance/integration/e2e test tiers |

### Engagement parameters

```yaml
target: /home/paulo/Projetos/usetheo/theokit-tools/theokit-sdk
reference: /home/paulo/Projetos/usetheo/theokit-tools/theokit-sdk/.claude/knowledge-base/reference/peer-js
scope: agent-SDK surface (packages/** vs core/+dev/)
focus: all dimensions
output_dir: /home/paulo/Projetos/usetheo/theokit-tools/theokit-sdk/cross-validation-output
max_iterations: 80
completion_promise: CROSS VALIDATION COMPLETE
```

---

*Generated by loop-cross-validation v0.1.0 — Ralph Wiggum + Autoresearch loop with SQLite-backed evidence and quality gates.*
