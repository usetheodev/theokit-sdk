# ADR index (D-series)

> **Generated, never hand-written.** Every line below is derived from the citations in `src/`.
> Regenerate with `node scripts/build-adr-index.mjs`, and `tests/lint/adr-index-covers-citations.test.ts`
> fails when a cited D-number is missing from it.

`src/` cites the D-series **877 times across 244 distinct decisions**, and those citations
carry real load — `internal/runtime/concurrency/async-semaphore.ts` justifies not depending on
`p-limit` by ADR D135, `security.ts` anchors its two-entry-point design on D68. None of them resolved
to anything in this repository: there is no `docs/adr/` in git and never was.

**This index does not restate the decisions — it locates them.** Writing a one-line summary per
D-number would mean paraphrasing 244 decisions from the comments that cite them, and a paraphrase of a
justification is a new claim. What is here is derived and checkable: for each number, every place it is
invoked and the citing line verbatim. A reader who meets `ADR D135` in a comment can now find every
other place that decision is load-bearing, and read what each one says it decided.

Full ADR bodies can follow incrementally. Until then, the citations resolve.


## D1

> Promoted from agent-builder in M75 (plan m75-sandbox-kernel-no-framework, D1): confinement with

Cited at 16 sites:

- `src/index.ts:106`
- `src/internal/agent-loop/types.ts:209`
- `src/internal/budget/tracker/budget-tracker-counter.ts:3`
- `src/internal/memory/storage/chunk-markdown.ts:6`
- `src/internal/memory/storage/markdown-store.ts:22`
- `src/internal/persistence/jsonl.ts:8`
- `src/internal/providers/catalog-schema.ts:6`
- `src/internal/runtime/lifecycle/stream-to-completion.ts:7`
- `src/internal/runtime/memory/memory-store.ts:16`
- `src/internal/runtime/system-prompt/safe-call.ts:10`
- `src/sandbox/bwrap.ts:1`
- `src/sandbox/linux-sandbox.ts:1`
- `src/sandbox/seccomp.ts:1`
- `src/sandbox/types.ts:4`
- `src/types/agent.ts:691`
- `src/types/budget-tracker.ts:3`

## D2

> registration is skipped builtins-first — so builtin providers still get their per-model data (ADR D2).

Cited at 17 sites:

- `src/a2a/subagent.ts:4`
- `src/internal/agent-loop/loop.ts:329`
- `src/internal/eval/code-runner.ts:9`
- `src/internal/llm/fallback-client.ts:7`
- `src/internal/llm/hermes-tool-extract.ts:175`
- `src/internal/llm/pool-aware-client.ts:12`
- `src/internal/memory/index-manager.ts:40`
- `src/internal/memory/vec-index.ts:5`
- `src/internal/persistence/session-writer.ts:13`
- `src/internal/persistence/session-writer.ts:21`
- `src/internal/providers/catalog-loader.ts:47`
- `src/internal/providers/catalog-loader.ts:129`
- `src/internal/zod-to-json-schema.ts:5`
- `src/messages.ts:35`
- `src/sandbox/provision.ts:5`
- `src/scorers.ts:352`
- `src/types/eval.ts:147`

## D3

> biome-ignore lint/complexity/noExcessiveCognitiveComplexity: RFC 8628 poll state machine (authorization_pending / slow_down / success / expiry) — a cohesive loop ported verbatim (ADR D3); fragmenting it would obscure the protocol.

Cited at 19 sites:

- `src/eval.ts:135`
- `src/internal/agent-loop/loop-llm-stream.ts:237`
- `src/internal/agent-loop/loop.ts:328`
- `src/internal/agent-loop/types.ts:239`
- `src/internal/auth/credential-store.ts:24`
- `src/internal/auth/credential-store.ts:252`
- `src/internal/auth/oauth-device.ts:52`
- `src/internal/auth/oauth-device.ts:117`
- `src/internal/auth/oauth-device.ts:279`
- `src/internal/auth/oauth-engine.ts:4`
- `src/internal/budget/pricing-registry.ts:143`
- `src/internal/memory/adapters/openai-embedding.ts:5`
- `src/internal/memory/embedding-adapter.ts:2`
- `src/internal/persistence/jsonl.ts:6`
- `src/internal/persistence/jsonl.ts:61`
- `src/internal/providers/builtin/google.ts:5`
- `src/internal/runtime/system-prompt/sources/context-provider.ts:9`
- `src/internal/runtime/tools/hitl-middleware.ts:4`
- `src/server/errors-envelope.ts:5`

## D4

> M43 D4 fix #2 — the two-step exchange returns a JWT access token but `parseTokenResponse` only reads a

Cited at 11 sites:

- `src/internal/agent-loop/loop.ts:329`
- `src/internal/auth/oauth-device.ts:321`
- `src/internal/auth/oauth-engine.ts:192`
- `src/internal/memory/index-manager-contract.ts:72`
- `src/internal/memory/vec-index.ts:5`
- `src/internal/persistence/persistence-schema.ts:22`
- `src/internal/providers/builtin/anthropic.ts:14`
- `src/internal/runtime/lifecycle/auto-summarize.ts:4`
- `src/internal/runtime/system-prompt/sources/skills-provider.ts:5`
- `src/internal/runtime/system-prompt/system-prompt.ts:11`
- `src/sandbox/seccomp.ts:167`

## D5

> Async disposal. Idempotent — calling more than once is a no-op (per ADR D5).

Cited at 10 sites:

- `src/internal/memory/storage/reader.ts:7`
- `src/internal/memory/tools.ts:11`
- `src/internal/runtime/system-prompt/sources/memory-provider.ts:5`
- `src/internal/runtime/system-prompt/types.ts:19`
- `src/server/auth/errors.ts:47`
- `src/server/auth/oauth-transaction-store.ts:4`
- `src/server/auth/oauth-transaction-store.ts:10`
- `src/server/auth/types.ts:25`
- `src/types/sdk-agent.ts:157`
- `src/types/sdk-agent.ts:163`

## D6

> Contributes the `<active-memory>` block (ADR D6 of memory-system-peer-project-parity).

Cited at 8 sites:

- `src/compaction.ts:14`
- `src/compaction.ts:100`
- `src/compaction.ts:137`
- `src/compaction.ts:183`
- `src/internal/memory/active-memory.ts:22`
- `src/internal/memory/storage/transcript-store.ts:7`
- `src/internal/runtime/system-prompt/sources/active-memory-provider.ts:5`
- `src/server/auth/index.ts:4`

## D7

> Dreaming sweep orchestrator (ADR D7 of memory-system-peer-project-parity).

Cited at 2 sites:

- `src/internal/memory/dreaming/diary.ts:8`
- `src/internal/memory/dreaming/run.ts:13`

## D8

> One-shot legacy-JSON → markdown migration (ADR D8 of memory-system-peer-project-parity).

Cited at 5 sites:

- `src/internal/memory/migration.ts:8`
- `src/internal/memory/types.ts:94`
- `src/internal/runtime/memory/memory-store.ts:18`
- `src/internal/runtime/system-prompt/pipeline.ts:12`
- `src/internal/runtime/system-prompt/safe-call.ts:8`

## D9

> Per ADR D9 — provider profile types are provider-specific (not unified).

Cited at 6 sites:

- `src/internal/llm/credential-pool.ts:11`
- `src/internal/runtime/system-prompt/escape.ts:2`
- `src/internal/runtime/system-prompt/sources/context-provider.ts:9`
- `src/internal/runtime/system-prompt/sources/memory-provider.ts:5`
- `src/internal/runtime/system-prompt/sources/skills-provider.ts:5`
- `src/server/auth/types.ts:37`

## D10

> Context source frontmatter schema (ADR D76 — mirrors D10 / hooks-frontmatter).

Cited at 4 sites:

- `src/generate-object.ts:187`
- `src/internal/runtime/context/context-frontmatter.ts:2`
- `src/internal/runtime/skills/skill-frontmatter.ts:19`
- `src/internal/structured-output-helpers.ts:46`

## D11

> Locked by ADR D11: `openai`, `mistral`, `openrouter`, `voyage`, `deepinfra`

Cited at 3 sites:

- `src/internal/memory/adapters/catalog.ts:21`
- `src/server/auth/types.ts:8`
- `src/server/auth/types.ts:54`

## D12

> Ships with the lancedb-backend-ship-v1-1 plan (close D12, supersede via

Cited at 1 site:

- `src/internal/memory/lance-memory-adapter.ts:20`

## D14

> D14 — Fault injection via `THEOKIT_TEST_RESPONSE_OVERRIDE` env var.

Cited at 2 sites:

- `src/internal/llm/fault-injection.ts:2`
- `src/internal/llm/router.ts:89`

## D15

> Canonical cloud-agent payload (ADR D15) — embedded in POST body as `agentConfig`. */

Cited at 6 sites:

- `src/internal/cloud-agent/cloud-agent.ts:75`
- `src/internal/cloud-agent/cloud-config-serializer.ts:15`
- `src/internal/cloud-agent/cloud-tool-parity.ts:6`
- `src/internal/cloud-agent/real-cloud-run.ts:35`
- `src/internal/cloud-agent/types.ts:8`
- `src/internal/runtime/registry/agent-registry-store.ts:53`

## D16

> Cloud tool parity validator (ADR D15 + D16).

Cited at 1 site:

- `src/internal/cloud-agent/cloud-tool-parity.ts:6`

## D17

> Write-through to disk per ADR D17: every mutation schedules a coalesced

Cited at 6 sites:

- `src/internal/cloud-agent/cloud-agent.ts:101`
- `src/internal/local-agent/local-agent-lifecycle.ts:121`
- `src/internal/runtime/registry/agent-registry-contract.ts:33`
- `src/internal/runtime/registry/agent-registry-store.ts:2`
- `src/internal/runtime/registry/agent-registry-store.ts:6`
- `src/internal/runtime/registry/agent-registry.ts:10`

## D18

> 1. Persist the assistant turn to the per-agent JSONL (ADR D18).

Cited at 2 sites:

- `src/internal/local-agent/local-agent-lifecycle.ts:121`
- `src/internal/runtime/lifecycle/post-run-lifecycle.ts:132`

## D19

> Post-run side effects executed inside the per-agent send mutex (ADR D19):

Cited at 3 sites:

- `src/internal/cloud-agent/cloud-agent.ts:159`
- `src/internal/local-agent/local-agent.ts:302`
- `src/internal/runtime/lifecycle/post-run-lifecycle.ts:130`

## D20

> subsystem is off unless switched on; this write has been on since ADR D20 for every agent that

Cited at 8 sites:

- `src/internal/local-agent/local-agent-memory.ts:162`
- `src/internal/local-agent/local-agent.ts:307`
- `src/internal/memory/index-manager-helpers.ts:120`
- `src/internal/memory/storage/session-loader.ts:8`
- `src/internal/memory/storage/session-summary-writer.ts:10`
- `src/internal/runtime/lifecycle/post-run-lifecycle.ts:90`
- `src/internal/runtime/lifecycle/post-run-lifecycle.ts:134`
- `src/internal/runtime/lifecycle/post-run-lifecycle.ts:245`

## D21

> D21: fall back to the persisted registry. Different cwds get isolated

Cited at 3 sites:

- `src/agent.ts:190`
- `src/agent.ts:484`
- `src/agent.ts:570`

## D22

> common to chat bots and other long-running agent consumers. See ADR D22.

Cited at 3 sites:

- `src/agent-builder.ts:145`
- `src/agent.ts:311`
- `src/index.ts:8`

## D23

> Handle returned by {@link createAgentFactory}. See ADR D23 for merge

Cited at 2 sites:

- `src/agent-factory.ts:5`
- `src/agent-factory.ts:28`

## D24

> dependency stays truly optional per ADR D24). The runtime JSON-Schema

Cited at 2 sites:

- `src/define-tool.ts:4`
- `src/define-tool.ts:176`

## D25

> Validation runs inside the terminals via `validateAgentOptions`. See ADR D25.

Cited at 3 sites:

- `src/agent-builder.ts:45`
- `src/agent.ts:214`
- `src/generate-object.ts:150`

## D26

> DX helpers — agent construction patterns (ADR D22-D26)

Cited at 1 site:

- `src/index.ts:8`

## D33

> Structured output via synthetic forced tool (ADR D33). M21 — `structuringModel` on

Cited at 7 sites:

- `src/agent-generate.ts:6`
- `src/agent.ts:232`
- `src/generate-object.ts:17`
- `src/index.ts:96`
- `src/internal/structured-output-helpers.ts:9`
- `src/stream-object.ts:92`
- `src/types/sdk-agent.ts:146`

## D34

> namespace is unavailable. ADR D34 — exporter errors are swallowed by `safe()`.

Cited at 8 sites:

- `src/internal/agent-loop/types.ts:206`
- `src/internal/eval/telemetry.ts:3`
- `src/internal/llm/sse.ts:116`
- `src/internal/task/telemetry.ts:9`
- `src/internal/telemetry/tracer.ts:7`
- `src/internal/telemetry/tracer.ts:105`
- `src/types/agent.ts:378`
- `src/types/agent.ts:558`

## D38

> Per ADR D428 (W3C wire format, independent of D38 a peer vendor AI Data Stream).

Cited at 2 sites:

- `src/subscription/internal/sse-encoder.ts:4`
- `src/subscription/internal/sse-parser.ts:8`

## D39

> `AsyncIterator<StreamObjectEvent<T>>` rather than a single Promise. See ADR D39.

Cited at 5 sites:

- `src/agent.ts:249`
- `src/index.ts:294`
- `src/internal/structured-output-helpers.ts:10`
- `src/stream-object.ts:18`
- `src/types/goal-events.ts:39`

## D41

> OAuth 2.1 PKCE flow configuration (ADR D41, v1.2+). When present, the

Cited at 6 sites:

- `src/internal/mcp/oauth.ts:2`
- `src/internal/mcp/token-storage.ts:10`
- `src/internal/mcp/token-storage.ts:227`
- `src/internal/mcp/token-storage.ts:299`
- `src/types/mcp.ts:41`
- `src/types/mcp.ts:49`

## D42

> Langfuse OTel adapter (ADR D42). Detects `@langfuse/node` and registers

Cited at 7 sites:

- `src/internal/telemetry/adapter-registry.ts:18`
- `src/internal/telemetry/adapters/langfuse.ts:5`
- `src/internal/telemetry/adapters/posthog.ts:4`
- `src/internal/telemetry/adapters/sentry.ts:4`
- `src/internal/telemetry/tracer.ts:8`
- `src/internal/telemetry/tracer.ts:200`
- `src/types/agent.ts:405`

## D43

> - `textScore` → T4.5 client-side term-overlap ratio (removes ADR D43 vector-only caveat)

Cited at 8 sites:

- `src/internal/memory/index-manager-contract.ts:78`
- `src/internal/memory/lance-index.ts:10`
- `src/internal/memory/lance-index.ts:190`
- `src/internal/memory/lance-memory-adapter.ts:21`
- `src/internal/memory/lance-memory-adapter.ts:121`
- `src/internal/memory/memory-index.ts:3`
- `src/internal/memory/memory-index.ts:10`
- `src/types/agent.ts:347`

## D44

> Mirrors @theokit/sdk-memory's migrateSqliteToLance entrypoint (ADR D44). */

Cited at 5 sites:

- `src/index.ts:233`
- `src/internal/memory/migrate-sqlite-to-lance.ts:11`
- `src/internal/memory/sdk-memory-peer-loader.ts:71`
- `src/migrate.ts:1`
- `src/migrate.ts:44`

## D45

> Partial object emitted during `Agent.streamObject<T>` streaming (ADR D45).

Cited at 1 site:

- `src/types/messages.ts:147`

## D50

> Corrupt JSON or other I/O error — log + degrade gracefully (D50/EC-7 cache pattern).

Cited at 1 site:

- `src/internal/task/store.ts:283`

## D60

> Path resolution for SDK state files (ADR D60).

Cited at 1 site:

- `src/internal/persistence/paths.ts:2`

## D61

> Cross-process safety: writes go through `withFileLock` (D61) and use

Cited at 7 sites:

- `src/internal/llm/credential-pool.ts:12`
- `src/internal/persistence/credential-pool-store.ts:25`
- `src/internal/persistence/credential-pool-store.ts:76`
- `src/internal/persistence/exclusive-create.ts:14`
- `src/internal/persistence/file-lock.ts:2`
- `src/internal/personality/store.ts:21`
- `src/internal/task/store.ts:207`

## D62

> Legacy on-disk shape (pre-D62 — `schemaVersion` string field + flat `agents`). */

Cited at 3 sites:

- `src/internal/persistence/schema-version.ts:2`
- `src/internal/runtime/registry/agent-registry-store.ts:25`
- `src/internal/runtime/registry/agent-registry-store.ts:30`

## D63

> `applyWalWithFallback` (T4.2, ADR D63) so NFS/SMB users get a graceful

Cited at 3 sites:

- `src/internal/memory/index-schema.ts:55`
- `src/internal/persistence/atomic-write.ts:37`
- `src/internal/persistence/sqlite-wal.ts:2`

## D64

> (T5.2, ADR D64). The new sanitizer is the 6-step port of Hermes'

Cited at 3 sites:

- `src/internal/memory/index-manager.ts:226`
- `src/internal/memory/index-manager.ts:441`
- `src/internal/persistence/fts5-sanitize.ts:2`

## D65

> call (ADR D65). Lets callers retry with the right backoff (`retryAfter`),

Cited at 6 sites:

- `src/errors.ts:111`
- `src/errors.ts:137`
- `src/errors.ts:281`
- `src/internal/security/path-guard.ts:12`
- `src/internal/security/path-guard.ts:30`
- `src/internal/security/path-guard.ts:49`

## D66

> (ADR D66). Consumers can `switch (err.metadata?.code)` exhaustively

Cited at 1 site:

- `src/errors.ts:8`

## D67

> which is what moved it here beside the other dialect-agnostic helpers ADR D67

Cited at 7 sites:

- `src/internal/error-mappers/anthropic.ts:2`
- `src/internal/error-mappers/bedrock.ts:2`
- `src/internal/error-mappers/openai-compatible.ts:2`
- `src/internal/error-mappers/shared.ts:3`
- `src/internal/error-mappers/shared.ts:105`
- `src/internal/error-mappers/vertex.ts:2`
- `src/internal/llm/pool-aware-client.ts:247`

## D68

> Post T1.1 (secret-redaction-discipline, ADR D68): every error metadata

Cited at 11 sites:

- `src/compaction.ts:170`
- `src/index.ts:277`
- `src/internal/error-mappers/shared.ts:43`
- `src/internal/memory/migrate-sqlite-to-lance.ts:119`
- `src/internal/memory/types.ts:89`
- `src/internal/runtime/registry/agent-registry-contract.ts:33`
- `src/internal/security/index.ts:2`
- `src/internal/security/redact.ts:5`
- `src/internal/security/redact.ts:13`
- `src/internal/telemetry/tracer.ts:210`
- `src/security.ts:2`

## D69

> D69: env snapshot captured at module load. Subsequent mutations of

Cited at 2 sites:

- `src/internal/security/redact.ts:14`
- `src/internal/security/redact.ts:23`

## D70

> D70: warn once on opt-out so the user knows they're vulnerable.

Cited at 4 sites:

- `src/internal/memory/migrate-sqlite-to-lance.ts:121`
- `src/internal/security/redact.ts:15`
- `src/internal/security/redact.ts:36`
- `src/migrate.ts:12`

## D71

> - D71: two-bucket masking — short fully masked, long preserves prefix+suffix

Cited at 4 sites:

- `src/internal/security/redact.ts:16`
- `src/internal/security/redact.ts:114`
- `src/internal/security/redact.ts:119`
- `src/internal/security/redact.ts:254`

## D72

> With `{ codeFile: true }` (D72), skips PARAM_PATTERN to avoid mangling

Cited at 2 sites:

- `src/internal/security/redact.ts:17`
- `src/internal/security/redact.ts:222`

## D73

> Barrel for the canonical secret-redaction module (ADRs D68-D73).

Cited at 3 sites:

- `src/internal/security/index.ts:2`
- `src/internal/security/redact.ts:5`
- `src/internal/security/redact.ts:18`

## D74

> ADRs: D74 (markdown format), D75 (1 file = 1 entity), D76 (Zod schema).

Cited at 2 sites:

- `src/internal/persistence/markdown-config-loader.ts:9`
- `src/internal/runtime/hooks/hooks-source.ts:3`

## D75

> ADRs: D74 (markdown format), D75 (1 file = 1 entity), D76 (Zod schema).

Cited at 1 site:

- `src/internal/persistence/markdown-config-loader.ts:9`

## D76

> Context source frontmatter schema (ADR D76 — mirrors D10 / hooks-frontmatter).

Cited at 3 sites:

- `src/internal/persistence/markdown-config-loader.ts:9`
- `src/internal/runtime/context/context-frontmatter.ts:2`
- `src/internal/runtime/plugins/plugin-frontmatter.ts:2`

## D77

> ADR D77: prefer PLUGIN.md; fall back to plugin.json with deprecation warn.

Cited at 4 sites:

- `src/internal/runtime/context/context-manager.ts:188`
- `src/internal/runtime/hooks/hooks-executor.ts:63`
- `src/internal/runtime/hooks/hooks-source.ts:3`
- `src/internal/runtime/plugins/plugins-manager.ts:79`

## D79

> Path safety primitives (ADRs D79-D85) live at `@theokit/sdk/path-safety`,

Cited at 5 sites:

- `src/index.ts:289`
- `src/internal/mcp/client.ts:188`
- `src/internal/memory/types.ts:106`
- `src/internal/runtime/plugins/plugins-manager.ts:111`
- `src/internal/security/path-guard.ts:2`

## D80

> ADR D79-D80: relative MCP `cwd` paths must safe-join under process.cwd()

Cited at 4 sites:

- `src/internal/mcp/client.ts:188`
- `src/internal/runtime/plugins/plugins-manager.ts:111`
- `src/internal/security/path-guard.ts:5`
- `src/internal/security/path-guard.ts:93`

## D81

> ADRs D79-D81: storePath is programmatic (trusted); namespace/scope/userId

Cited at 5 sites:

- `src/internal/memory/types.ts:106`
- `src/internal/runtime/context/context-discovery.ts:172`
- `src/internal/security/path-guard.ts:2`
- `src/internal/security/path-guard.ts:9`
- `src/workflow.ts:665`

## D82

> O_EXCL exclusive file creation (ADR D82).

Cited at 1 site:

- `src/internal/persistence/exclusive-create.ts:2`

## D83

> SQLite optimistic compare-and-swap (ADR D83).

Cited at 1 site:

- `src/internal/persistence/sqlite-cas.ts:2`

## D85

> Path safety primitives (ADRs D79-D85) live at `@theokit/sdk/path-safety`,

Cited at 2 sites:

- `src/index.ts:289`
- `src/internal/security/path-guard.ts:16`

## D86

> Step 1 — D86-D88 repair middleware. Returns the (possibly rewritten) call

Cited at 2 sites:

- `src/internal/agent-loop/tool-dispatch.ts:64`
- `src/internal/agent-loop/tool-dispatch.ts:132`

## D87

> biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 3 sequential repair stages (name match / args parse / type coerce) live in one function by design — splitting them hides the repair order (ADR D87) that callers reason about via the `repairs` log.

Cited at 2 sites:

- `src/internal/tool-dispatch/repair-middleware.ts:2`
- `src/internal/tool-dispatch/repair-middleware.ts:49`

## D88

> Step 1 — D86-D88 repair middleware. Returns the (possibly rewritten) call

Cited at 4 sites:

- `src/internal/agent-loop/tool-dispatch.ts:64`
- `src/internal/agent-loop/tool-dispatch.ts:132`
- `src/internal/tool-dispatch/repair-middleware.ts:5`
- `src/internal/tool-dispatch/repair-middleware.ts:58`

## D89

> Validate-then-execute dispatch wrapper (T1.3, ADR D89).

Cited at 1 site:

- `src/internal/tool-dispatch/dispatch.ts:2`

## D90

> T4.2 (ADRs D90-D91): explicit iteration budget. When omitted, the loop

Cited at 3 sites:

- `src/internal/agent-loop/types.ts:158`
- `src/internal/budget/tracker/budget.ts:2`
- `src/internal/budget/tracker/budget.ts:45`

## D91

> T4.2 (ADRs D90-D91): explicit iteration budget. When omitted, the loop

Cited at 3 sites:

- `src/internal/agent-loop/types.ts:158`
- `src/internal/budget/tracker/budget.ts:2`
- `src/internal/budget/tracker/budget.ts:38`

## D92

> Compression helpers (T2.3, ADR D92).

Cited at 1 site:

- `src/internal/runtime/compression/compression-helpers.ts:2`

## D93

> T2.1 (ADR D93) — maximum number of bailout-nudge user messages to inject. */

Cited at 2 sites:

- `src/internal/agent-loop/loop.ts:45`
- `src/internal/runtime/validation/validate-response.ts:2`

## D94

> for the rebuilt cache; see ADRs D94-D95). Use sparingly and deliberately.

Cited at 4 sites:

- `src/internal/local-agent/local-agent-invalidate.ts:4`
- `src/internal/local-agent/local-agent.ts:520`
- `src/internal/local-agent/local-agent.ts:533`
- `src/types/sdk-agent.ts:205`

## D95

> for the rebuilt cache; see ADRs D94-D95). Use sparingly and deliberately.

Cited at 1 site:

- `src/types/sdk-agent.ts:205`

## D96

> Strip `<think>...</think>` chain-of-thought blocks (T1.2, ADR D96).

Cited at 1 site:

- `src/internal/tool-dispatch/strip-think.ts:2`

## D97

> Plugin contract — RUNTIME value + type re-exports (T1.1, ADRs D97-D101).

Cited at 6 sites:

- `src/index.ts:148`
- `src/internal/local-agent/local-agent.ts:231`
- `src/internal/plugins/index.ts:2`
- `src/internal/plugins/manager.ts:4`
- `src/internal/plugins/types.ts:2`
- `src/types/plugin.ts:2`

## D98

> The plugin extension point `{ kind: "memory" }` (ADR D98) declares a

Cited at 2 sites:

- `src/internal/runtime/lifecycle/fork-agent.ts:55`
- `src/types/memory-adapter.ts:4`

## D99

> PluginContext implementation + dev-mode seal (T1.2, ADR D99).

Cited at 1 site:

- `src/internal/plugins/context.ts:2`

## D100

> Hooks are a fixed enum (D100) to prevent sprawl; `pre_tool_call` supports

Cited at 1 site:

- `src/types/plugin.ts:9`

## D101

> veto via `{ block: true, message }` (D101) so plugins can implement safety

Cited at 9 sites:

- `src/internal/agent-loop/tool-dispatch.ts:67`
- `src/internal/agent-loop/tool-dispatch.ts:216`
- `src/internal/local-agent/local-agent.ts:231`
- `src/internal/plugins/index.ts:2`
- `src/internal/plugins/manager.ts:4`
- `src/internal/plugins/manager.ts:122`
- `src/internal/plugins/types.ts:2`
- `src/types/plugin.ts:2`
- `src/types/plugin.ts:10`

## D102

> active personality preset's `tools` whitelist (T4.1, ADRs D102+D167).

Cited at 2 sites:

- `src/internal/tool-registry/personality-filter.ts:3`
- `src/internal/tool-registry/registry.ts:2`

## D103

> biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 3-layer check (requiresEnv loop / checkFn presence / cache hit/miss) inlined for clarity per ADR D103.

Cited at 2 sites:

- `src/internal/tool-registry/check-fn-cache.ts:2`
- `src/internal/tool-registry/check-fn-cache.ts:22`

## D104

> Toolset — Layer 2 of the 3-layer tool surface (T2.2, ADR D104).

Cited at 1 site:

- `src/internal/tool-registry/toolset.ts:2`

## D105

> ProviderProfile + ApiMode + AuthType contract types (T3.1, ADR D105).

Cited at 4 sites:

- `src/internal/llm/router.ts:19`
- `src/internal/providers/index.ts:2`
- `src/internal/providers/types.ts:2`
- `src/types/provider-profile.ts:2`

## D106

> object literal; the Transport layer (D106) consumes `apiMode` to pick

Cited at 1 site:

- `src/types/provider-profile.ts:5`

## D107

> `registerProvider` is idempotent + WARN-on-override (ADR D107), so calling

Cited at 6 sites:

- `src/internal/llm/router.ts:19`
- `src/internal/providers/discovery.ts:2`
- `src/internal/providers/index.ts:2`
- `src/internal/providers/register-plugin-providers.ts:7`
- `src/internal/providers/registry.ts:2`
- `src/internal/providers/registry.ts:5`

## D109

> Plugin & extension system (v1.8 — ADRs D97-D109)

Cited at 1 site:

- `src/index.ts:148`

## D110

> Spawn a forked auxiliary agent (ADR D110). Reads `Agent.create` from

Cited at 4 sites:

- `src/internal/cloud-agent/cloud-agent.ts:326`
- `src/internal/local-agent/local-agent-runtime-extensions.ts:106`
- `src/internal/runtime/lifecycle/fork-agent.ts:2`
- `src/types/fork.ts:2`

## D111

> Step 2 — D111 fork whitelist gate. Fires BEFORE plugin/file hooks because

Cited at 7 sites:

- `src/internal/agent-loop/tool-dispatch.ts:65`
- `src/internal/agent-loop/tool-dispatch.ts:153`
- `src/internal/llm/credential-pool-context.ts:4`
- `src/internal/runtime/concurrency/async-local-storage.ts:2`
- `src/internal/runtime/lifecycle/fork-agent.ts:7`
- `src/internal/runtime/lifecycle/fork-agent.ts:72`
- `src/types/sdk-agent.ts:238`

## D112

> Override system prompt. Default: byte-identical inheritance from parent (D112). */

Cited at 4 sites:

- `src/internal/runtime/lifecycle/fork-agent.ts:6`
- `src/internal/runtime/lifecycle/fork-agent.ts:71`
- `src/types/fork.ts:27`
- `src/types/sdk-agent.ts:237`

## D114

> (D114 + EC-B fix); general/model-provider plugins are dropped because

Cited at 7 sites:

- `src/internal/cloud-agent/cloud-agent.ts:326`
- `src/internal/runtime/lifecycle/fork-agent.ts:2`
- `src/internal/runtime/lifecycle/fork-agent.ts:9`
- `src/internal/runtime/lifecycle/fork-agent.ts:49`
- `src/types/agent.ts:563`
- `src/types/fork.ts:2`
- `src/types/fork.ts:29`

## D115

> {@link SDKAgent.runUntil} (ADRs D115-D117). Discriminated union by the `type` field so

Cited at 4 sites:

- `src/goal-loop.ts:34`
- `src/internal/runtime/lifecycle/run-until.ts:2`
- `src/types/goal-events.ts:37`
- `src/types/sdk-agent.ts:213`

## D116

> `AsyncGenerator<GoalEvent, GoalResult, void>` shape (ADR D116).

Cited at 1 site:

- `src/internal/local-agent/local-agent-runtime-extensions.ts:32`

## D117

> {@link SDKAgent.runUntil} (ADRs D115-D117). Discriminated union by the `type` field so

Cited at 2 sites:

- `src/types/goal-events.ts:37`
- `src/types/goal-events.ts:139`

## D119

> Judge model identifier. Default `"openai/gpt-4o-mini"` (ADR D119). */

Cited at 3 sites:

- `src/internal/judge/judge-call.ts:3`
- `src/internal/judge/judge-call.ts:7`
- `src/types/goal-events.ts:121`

## D120

> Public types for the judge subsystem (T2.1, ADR D120).

Cited at 2 sites:

- `src/internal/judge/parse-verdict.ts:2`
- `src/internal/judge/types.ts:2`

## D121

> Identical semantics to `Agent.runUntil` (ADRs D115-D121 + M55 token budget / states).

Cited at 9 sites:

- `src/goal-loop.ts:34`
- `src/internal/judge/judge-call.ts:3`
- `src/internal/judge/judge-call.ts:100`
- `src/internal/judge/parse-verdict.ts:2`
- `src/internal/judge/parse-verdict.ts:52`
- `src/internal/runtime/lifecycle/run-until.ts:2`
- `src/types/goal-events.ts:49`
- `src/types/goal-events.ts:119`
- `src/types/sdk-agent.ts:213`

## D122

> Cloud runtime manages goal loops server-side (ADR D122). The local

Cited at 2 sites:

- `src/internal/cloud-agent/cloud-agent.ts:312`
- `src/internal/runtime/registry/agent-registry-contract.ts:26`

## D123

> In-memory credential pool with strategy-based rotation (ADRs D123-D133).

Cited at 6 sites:

- `src/internal/llm/credential-pool-types.ts:2`
- `src/internal/llm/credential-pool.ts:2`
- `src/internal/llm/pool-aware-client.ts:3`
- `src/internal/llm/router.ts:34`
- `src/internal/persistence/credential-pool-store.ts:2`
- `src/types/providers.ts:44`

## D124

> Closed enum per ADR D124 — adding a strategy is an explicit semver

Cited at 1 site:

- `src/internal/llm/credential-pool-types.ts:19`

## D125

> Decision matrix per ADR D125 + D126. Pure function — testable in isolation.

Cited at 2 sites:

- `src/internal/llm/credential-pool-types.ts:85`
- `src/internal/llm/pool-aware-client.ts:222`

## D126

> Decision matrix per ADR D125 + D126. Pure function — testable in isolation.

Cited at 2 sites:

- `src/internal/llm/pool-aware-client.ts:159`
- `src/internal/llm/pool-aware-client.ts:222`

## D127

> Decorator pattern (D127 inspired): wraps any `LlmClient` and short-circuits

Cited at 2 sites:

- `src/internal/llm/fault-injection.ts:4`
- `src/internal/llm/pool-aware-client.ts:5`

## D128

> (worst case = 1 extra 429 per race) — acceptable per ADR D128.

Cited at 1 site:

- `src/internal/llm/credential-pool.ts:14`

## D129

> rapid mutations into one write (D129). Pending timer is `clearTimeout`'d

Cited at 3 sites:

- `src/internal/persistence/credential-pool-store.ts:2`
- `src/internal/persistence/credential-pool-store.ts:21`
- `src/internal/persistence/credential-pool-store.ts:105`

## D131

> Per-fork credential-pool inheritance via `AsyncLocalStorage` (ADR D131).

Cited at 2 sites:

- `src/batch.ts:6`
- `src/internal/llm/credential-pool-context.ts:2`

## D132

> - `explicit-apikey` — wrapped from `AgentOptions.apiKey` single-key path (D132)

Cited at 1 site:

- `src/internal/llm/credential-pool-types.ts:35`

## D133

> In-memory credential pool with strategy-based rotation (ADRs D123-D133).

Cited at 6 sites:

- `src/errors.ts:476`
- `src/internal/llm/credential-pool-types.ts:2`
- `src/internal/llm/credential-pool.ts:2`
- `src/internal/llm/pool-aware-client.ts:3`
- `src/internal/llm/router.ts:34`
- `src/types/providers.ts:44`

## D134

> Run N prompts in parallel with bounded concurrency (ADRs D134-D140).

Cited at 3 sites:

- `src/agent.ts:284`
- `src/batch.ts:2`
- `src/types/batch.ts:2`

## D135

> Thin re-export of the in-house concurrency helpers (ADR D135 — no

Cited at 5 sites:

- `src/concurrency.ts:4`
- `src/internal/agent-loop/tool-dispatch.ts:23`
- `src/internal/runtime/concurrency/async-semaphore.ts:2`
- `src/internal/runtime/concurrency/map-with-concurrency.ts:8`
- `src/internal/task/registry.ts:4`

## D136

> Row concurrency. Default 4 (matches `Agent.batch` D136). MUST be in

Cited at 2 sites:

- `src/types/batch.ts:41`
- `src/types/eval.ts:81`

## D138

> prompt gets an agent created with these options (ADR D138 isolation),

Cited at 1 site:

- `src/types/batch.ts:34`

## D139

> `toShareGptTrajectory` — opt-in BatchResult → ShareGPT converter (ADR D139).

Cited at 3 sites:

- `src/index.ts:317`
- `src/trajectory-helpers.ts:2`
- `src/types/trajectory.ts:2`

## D140

> Run N prompts in parallel with bounded concurrency (ADRs D134-D140).

Cited at 6 sites:

- `src/agent.ts:284`
- `src/batch.ts:2`
- `src/types/batch.ts:2`
- `src/types/batch.ts:62`
- `src/types/eval.ts:263`
- `src/types/run.ts:414`

## D141

> ADR D141 / D142: `agent.memory.*` direct API over plugin-aggregated adapters.

Cited at 12 sites:

- `src/errors.ts:511`
- `src/errors.ts:525`
- `src/index.ts:231`
- `src/internal/local-agent/local-agent-memory-direct.ts:2`
- `src/internal/local-agent/local-agent-memory-hooks.ts:2`
- `src/internal/local-agent/local-agent.ts:209`
- `src/memory-adapter-helpers.ts:2`
- `src/types/agent.ts:573`
- `src/types/memory-adapter.ts:2`
- `src/types/plugin.ts:61`
- `src/types/plugin.ts:277`
- `src/types/sdk-agent.ts:287`

## D142

> ADR D141 / D142: `agent.memory.*` direct API over plugin-aggregated adapters.

Cited at 3 sites:

- `src/internal/local-agent/local-agent-memory-direct.ts:2`
- `src/internal/local-agent/local-agent.ts:209`
- `src/types/sdk-agent.ts:287`

## D145

> Memory hook wiring for `LocalAgent.sendLocked` (T2.1, ADRs D141 / D145).

Cited at 4 sites:

- `src/internal/local-agent/local-agent-memory-hooks.ts:2`
- `src/types/plugin.ts:61`
- `src/types/plugin.ts:185`
- `src/types/plugin.ts:211`

## D147

> Public `MemoryAdapter` contract (T1.1, ADRs D141 / D147).

Cited at 1 site:

- `src/types/memory-adapter.ts:2`

## D150

> Phase 5 (ADRs D150-D156): multi-format discovery for AGENTS.md,

Cited at 3 sites:

- `src/internal/runtime/context/context-discovery-runner.ts:2`
- `src/internal/runtime/context/context-discovery.ts:2`
- `src/internal/runtime/context/context-manager.ts:102`

## D151

> Context file discovery (T1.1, ADRs D150 / D151).

Cited at 1 site:

- `src/internal/runtime/context/context-discovery.ts:2`

## D154

> MDC (Markdown Cursor) parser for `.cursor/rules/*.mdc` (T3.1, ADR D154).

Cited at 2 sites:

- `src/internal/runtime/context/context-loaders.ts:2`
- `src/internal/runtime/context/context-mdc-parser.ts:2`

## D155

> When total exceeds this, lower-priority sources are dropped (ADR D155).

Cited at 7 sites:

- `src/internal/runtime/context/context-aggregator.ts:2`
- `src/internal/runtime/context/context-aggregator.ts:17`
- `src/internal/runtime/context/context-discovery-runner.ts:49`
- `src/internal/runtime/context/context-loaders.ts:2`
- `src/internal/runtime/context/context-loaders.ts:18`
- `src/types/context.ts:23`
- `src/types/context.ts:30`

## D156

> Phase 5 (ADRs D150-D156): multi-format discovery for AGENTS.md,

Cited at 3 sites:

- `src/internal/runtime/context/context-discovery-runner.ts:2`
- `src/internal/runtime/context/context-import-resolver.ts:2`
- `src/internal/runtime/context/context-manager.ts:102`

## D159

> Context file loaders + truncation (T1.2, ADRs D154 / D155 / D159).

Cited at 1 site:

- `src/internal/runtime/context/context-loaders.ts:2`

## D160

> Personality presets — lazy-loaded on first `usePersonality` call (ADRs D160-D164). @internal */

Cited at 7 sites:

- `src/index.ts:272`
- `src/internal/local-agent/local-agent-personality-extensions.ts:6`
- `src/internal/local-agent/local-agent-personality-extensions.ts:76`
- `src/internal/local-agent/local-agent.ts:162`
- `src/internal/local-agent/local-agent.ts:525`
- `src/internal/personality/resolver.ts:4`
- `src/types/sdk-agent.ts:317`

## D161

> Personality preset types + Zod frontmatter schema (T1.1, ADR D161).

Cited at 2 sites:

- `src/internal/personality/registry.ts:3`
- `src/internal/personality/types.ts:2`

## D162

> + user dirs (T1.1, ADRs D161 / D162).

Cited at 1 site:

- `src/internal/personality/registry.ts:3`

## D163

> ADR D163 — hydrate previously-active personality slug (no-op if none).

Cited at 2 sites:

- `src/internal/local-agent/local-agent.ts:258`
- `src/internal/personality/store.ts:3`

## D164

> Personality presets — lazy-loaded on first `usePersonality` call (ADRs D160-D164). @internal */

Cited at 3 sites:

- `src/internal/local-agent/local-agent.ts:162`
- `src/internal/local-agent/local-agent.ts:525`
- `src/internal/personality/switch.ts:4`

## D167

> active personality preset's `tools` whitelist (T4.1, ADRs D102+D167).

Cited at 4 sites:

- `src/internal/local-agent/real-local-run-tools.ts:152`
- `src/internal/local-agent/real-local-run.ts:72`
- `src/internal/tool-registry/personality-filter.ts:3`
- `src/internal/tool-registry/personality-filter.ts:14`

## D168

> ADR D168 + EC-A — capture the slug ONCE at fork-construction time.

Cited at 5 sites:

- `src/internal/local-agent/local-agent-personality-extensions.ts:6`
- `src/internal/local-agent/local-agent-personality-extensions.ts:9`
- `src/internal/local-agent/local-agent-personality-extensions.ts:112`
- `src/internal/local-agent/local-agent-runtime-extensions.ts:119`
- `src/internal/personality/context.ts:2`

## D169

> to avoid silent divergence between local and cloud behaviour (ADR D169).

Cited at 3 sites:

- `src/index.ts:272`
- `src/internal/cloud-agent/cloud-agent.ts:366`
- `src/types/sdk-agent.ts:317`

## D182

> ADR D182 / T1.2: explicit `providers.routes[0].provider` wins, then prefix

Cited at 11 sites:

- `src/internal/auth/api-key-validator.ts:14`
- `src/internal/llm/model-identifier.ts:2`
- `src/internal/llm/router.ts:196`
- `src/internal/llm/router.ts:251`
- `src/internal/local-agent/real-local-run.ts:134`
- `src/internal/providers/builtin/llamacpp.ts:9`
- `src/internal/providers/builtin/lmstudio.ts:9`
- `src/internal/providers/builtin/ollama.ts:4`
- `src/internal/runtime/compression/compression-model-registry.ts:80`
- `src/internal/runtime/fixtures/fixture-mode.ts:101`
- `src/internal/runtime/fixtures/fixture-mode.ts:217`

## D183

> ship in v1.0. ADR D183: `ollama` added — first `transport: "local"`

Cited at 3 sites:

- `src/internal/memory/adapters/catalog.ts:22`
- `src/internal/memory/adapters/ollama-embedding.ts:2`
- `src/memory.ts:85`

## D184

> ADR D184: when caller passed `{ provider }` targeting a profile with

Cited at 4 sites:

- `src/internal/catalog/local-models.ts:3`
- `src/theokit.ts:38`
- `src/theokit.ts:79`
- `src/theokit.ts:190`

## D185

> Provider name for error mapping dispatch (T1.1, ADR D185). When set

Cited at 3 sites:

- `src/internal/error-mappers/ollama.ts:2`
- `src/internal/llm/openai.ts:55`
- `src/internal/llm/router.ts:415`

## D186

> infer the provider via prefix routing (D186). The client strips the

Cited at 1 site:

- `src/internal/providers/builtin/bedrock.ts:9`

## D187

> EC-C MUST FIX (ADR D187): `authType: "none"` providers ignore apiKeys.

Cited at 2 sites:

- `src/internal/llm/fault-injection.ts:172`
- `src/internal/llm/router.ts:147`

## D188

> sibling profiles (ADRs D182/D188/D189) whose `authType` is `"none"`.

Cited at 4 sites:

- `src/internal/auth/api-key-validator.ts:14`
- `src/internal/llm/router.ts:430`
- `src/internal/providers/builtin/lmstudio.ts:4`
- `src/internal/runtime/compression/compression-model-registry.ts:80`

## D189

> sibling profiles (ADRs D182/D188/D189) whose `authType` is `"none"`.

Cited at 4 sites:

- `src/internal/auth/api-key-validator.ts:14`
- `src/internal/llm/router.ts:430`
- `src/internal/providers/builtin/llamacpp.ts:4`
- `src/internal/runtime/compression/compression-model-registry.ts:81`

## D191

> biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 4-mode transport ladder (chat_completions / anthropic_messages / responses_api / bedrock) + Ollama native dispatch (D191) + per-provider envOverride is one cohesive switch — splitting hurts readability and obscures the dispatch contract.

Cited at 3 sites:

- `src/internal/llm/ollama-native.ts:2`
- `src/internal/llm/router.ts:335`
- `src/internal/llm/router.ts:405`

## D192

> ADR D192: 24h keep_alive prevents Ollama from evicting the chat model

Cited at 1 site:

- `src/internal/llm/ollama-native.ts:301`

## D201

> Local introspection of bundled SDK assets (ADR D201). Unlike the

Cited at 1 site:

- `src/theokit.ts:136`

## D202

> Public `Eval` namespace (Adoption Roadmap #2, ADRs D202-D213).

Cited at 2 sites:

- `src/eval.ts:2`
- `src/types/eval.ts:3`

## D203

> Built-in scorers for `Eval.create` (Adoption Roadmap #2, ADR D203).

Cited at 1 site:

- `src/scorers.ts:2`

## D204

> Resolve the agent factory for a given dataset entry, honoring D204's

Cited at 2 sites:

- `src/internal/eval/runner.ts:2`
- `src/internal/eval/runner.ts:196`

## D205

> Bias note (D205):** `apiKey` is intentionally separate so callers

Cited at 3 sites:

- `src/internal/scorers/llm-judge.ts:2`
- `src/scorers.ts:323`
- `src/scorers.ts:330`

## D206

> D206 — open `eval.run` span (no-op when OTel unavailable). MUST end in finally.

Cited at 3 sites:

- `src/internal/eval/runner.ts:394`
- `src/internal/eval/runner.ts:442`
- `src/internal/eval/telemetry.ts:2`

## D207

> Scorer signature (D207). Returns `Score` synchronously OR via Promise —

Cited at 1 site:

- `src/types/eval.ts:41`

## D208

> Run the eval. Resolves with a populated {@link EvalRun}. Per D208,

Cited at 1 site:

- `src/eval.ts:121`

## D209

> Final run result — plain serializable JSON (D209). */

Cited at 1 site:

- `src/types/eval.ts:192`

## D210

> fine for v1; eval datasets are bounded by D210 streaming-deferral).

Cited at 3 sites:

- `src/internal/eval/aggregate.ts:5`
- `src/internal/eval/dataset-iter.ts:2`
- `src/types/eval.ts:27`

## D211

> Aggregate stats — the production-decision dashboard data (D211). */

Cited at 3 sites:

- `src/internal/eval/aggregate.ts:2`
- `src/internal/eval/runner.ts:442`
- `src/types/eval.ts:177`

## D213

> Concurrent runs with the same name throw `EvalAlreadyRunningError` (D213).

Cited at 6 sites:

- `src/eval.ts:2`
- `src/eval.ts:122`
- `src/internal/eval/single-flight.ts:2`
- `src/internal/workflow/single-flight.ts:6`
- `src/types/eval.ts:3`
- `src/types/eval.ts:63`

## D214

> Declarative handoff destinations (Adoption Roadmap #4; ADRs D214-D229).

Cited at 2 sites:

- `src/types/agent.ts:590`
- `src/types/agent.ts:595`

## D215

> destination (D214/D215). When the LLM invokes one, the receiver takes

Cited at 1 site:

- `src/types/agent.ts:595`

## D217

> over the next turn (peer-to-peer, D217).

Cited at 1 site:

- `src/types/agent.ts:596`

## D218

> Maximum chain depth across handoffs per `agent.send()` call (D218).

Cited at 1 site:

- `src/types/agent.ts:609`

## D229

> Declarative handoff destinations (Adoption Roadmap #4; ADRs D214-D229).

Cited at 2 sites:

- `src/internal/workflow/step-fn.ts:5`
- `src/types/agent.ts:590`

## D230

> Workflow executor (ADRs D230-D248).

Cited at 3 sites:

- `src/internal/workflow/executor.ts:2`
- `src/types/workflow.ts:3`
- `src/workflow.ts:4`

## D232

> ─── Step discriminated union (D232) ─── */

Cited at 1 site:

- `src/types/workflow.ts:18`

## D233

> biome-ignore lint/suspicious/noThenProperty: D233 locks the a peer framework-style `.then(step)` builder DSL. The method is fluent, never awaited.

Cited at 1 site:

- `src/workflow.ts:140`

## D235

> Snapshot store interface + InMemory and JsonFile backends (ADR D235).

Cited at 2 sites:

- `src/internal/workflow/executor.ts:6`
- `src/internal/workflow/snapshot-store.ts:2`

## D236

> suspend (sentinel pattern; D236), single-flight (D242), abort signal

Cited at 2 sites:

- `src/internal/workflow/ctx.ts:4`
- `src/internal/workflow/executor.ts:5`

## D237

> Wraps in `withRetry` if a retry policy is set (D237).

Cited at 3 sites:

- `src/internal/workflow/retry-policy.ts:2`
- `src/internal/workflow/step-fn.ts:3`
- `src/types/workflow.ts:165`

## D238

> D238 — slot reserved; runtime throws if engine not yet implemented. */

Cited at 3 sites:

- `src/internal/workflow/step-fn.ts:55`
- `src/types/workflow.ts:52`
- `src/types/workflow.ts:666`

## D240

> Concurrency: bounded by `step.concurrency ?? branches.length` (D240). All

Cited at 1 site:

- `src/internal/workflow/step-parallel.ts:9`

## D241

> OTel telemetry for workflows (ADR D241).

Cited at 1 site:

- `src/internal/workflow/telemetry.ts:2`

## D242

> suspend (sentinel pattern; D236), single-flight (D242), abort signal

Cited at 2 sites:

- `src/internal/workflow/executor.ts:5`
- `src/internal/workflow/single-flight.ts:2`

## D244

> wait for completion, return the result text as step output (ADR D244,

Cited at 2 sites:

- `src/internal/workflow/step-agent.ts:3`
- `src/internal/workflow/step-agent.ts:24`

## D245

> boundaries (D245), and snapshot persistence opt-in (D235).

Cited at 3 sites:

- `src/internal/workflow/executor.ts:6`
- `src/internal/workflow/step-agent.ts:4`
- `src/internal/workflow/step-sleep.ts:3`

## D247

> D247 — context handed to every step.fn. */

Cited at 1 site:

- `src/types/workflow.ts:175`

## D248

> Workflow executor (ADRs D230-D248).

Cited at 3 sites:

- `src/internal/workflow/executor.ts:2`
- `src/types/workflow.ts:3`
- `src/workflow.ts:4`

## D264

> unsupported OpenAI params (D264-style trade-off).

Cited at 1 site:

- `src/internal/llm/vertex-gemini.ts:9`

## D279

> (D279/EC-6) — this module is auth-resolution only.

Cited at 1 site:

- `src/internal/llm/bedrock-token-cache.ts:12`

## D286

> D286/D288: `aws_bearer` / `gcp_oauth` profiles use a lazy sentinel so the

Cited at 6 sites:

- `src/internal/llm/bedrock-anthropic.ts:3`
- `src/internal/llm/router.ts:198`
- `src/internal/llm/router.ts:260`
- `src/internal/providers/builtin/bedrock.ts:2`
- `src/internal/providers/builtin/vertex.ts:2`
- `src/internal/runtime/fixtures/fixture-mode.ts:153`

## D287

> strip the lazy sentinel so client triggers @aws/bedrock-token-generator (D287).

Cited at 6 sites:

- `src/internal/llm/bedrock-anthropic.ts:37`
- `src/internal/llm/bedrock-token-cache.ts:2`
- `src/internal/llm/bedrock-token-cache.ts:6`
- `src/internal/llm/router.ts:465`
- `src/internal/providers/builtin/bedrock.ts:6`
- `src/internal/runtime/fixtures/fixture-mode.ts:153`

## D288

> D286/D288: `aws_bearer` / `gcp_oauth` profiles use a lazy sentinel so the

Cited at 8 sites:

- `src/internal/llm/router.ts:198`
- `src/internal/llm/router.ts:260`
- `src/internal/llm/router.ts:448`
- `src/internal/llm/vertex-anthropic.ts:43`
- `src/internal/llm/vertex-auth.ts:2`
- `src/internal/llm/vertex-gemini.ts:8`
- `src/internal/providers/builtin/vertex.ts:4`
- `src/internal/runtime/fixtures/fixture-mode.ts:194`

## D289

> Identical across the three Anthropic-compatible clients (D289/D292).

Cited at 3 sites:

- `src/internal/llm/anthropic-shared.ts:104`
- `src/internal/llm/bedrock-anthropic.ts:8`
- `src/internal/llm/bedrock-anthropic.ts:96`

## D290

> Infer AWS region from a Bedrock model id prefix (D290).

Cited at 1 site:

- `src/internal/providers/builtin/bedrock.ts:38`

## D291

> OpenAI-compat endpoint (D291) — the client appends `/chat/completions`.

Cited at 4 sites:

- `src/internal/llm/vertex-gemini.ts:2`
- `src/internal/llm/vertex-router.ts:2`
- `src/internal/providers/builtin/vertex.ts:8`
- `src/internal/providers/builtin/vertex.ts:45`

## D292

> D292: anthropic_version is REQUIRED in body (not header) and `model` is stripped.

Cited at 6 sites:

- `src/internal/llm/anthropic-shared.ts:104`
- `src/internal/llm/vertex-anthropic.ts:3`
- `src/internal/llm/vertex-anthropic.ts:10`
- `src/internal/llm/vertex-anthropic.ts:108`
- `src/internal/llm/vertex-router.ts:2`
- `src/internal/providers/builtin/vertex.ts:9`

## D293

> D293 absorbed: when location === "global", use `aiplatform.googleapis.com`

Cited at 2 sites:

- `src/internal/llm/vertex-anthropic.ts:3`
- `src/internal/providers/builtin/vertex.ts:31`

## D294

> Uses native `fetch` only — no `@anthropic-ai/vertex-sdk` (D294).

Cited at 1 site:

- `src/internal/llm/vertex-anthropic.ts:15`

## D295

> Vertex AI access token + config resolution (ADRs D288, D295).

Cited at 2 sites:

- `src/internal/llm/bedrock-token-cache.ts:2`
- `src/internal/llm/vertex-auth.ts:2`

## D300

> GCP Vertex AI HTTP error mapper (ADRs D67, D300).

Cited at 2 sites:

- `src/internal/error-mappers/bedrock.ts:2`
- `src/internal/error-mappers/vertex.ts:2`

## D301

> D301: dedicated Bedrock InvokeModel client. apiKey from env when set;

Cited at 3 sites:

- `src/internal/llm/router.ts:444`
- `src/internal/llm/router.ts:464`
- `src/internal/llm/vertex-router.ts:2`

## D302

> v1: non-streaming only (`POST /model/{id}/invoke`). D302 defers

Cited at 5 sites:

- `src/internal/llm/bedrock-anthropic.ts:3`
- `src/internal/llm/bedrock-anthropic.ts:5`
- `src/internal/llm/bedrock-anthropic.ts:11`
- `src/internal/providers/builtin/bedrock.ts:2`
- `src/internal/providers/builtin/vertex.ts:2`

## D307

> Live-agent cache for production deploys (Production-Readiness #2, ADRs D307-D310).

Cited at 4 sites:

- `src/agent.ts:77`
- `src/index.ts:200`
- `src/internal/runtime/registry/live-agent-registry.ts:2`
- `src/internal/runtime/registry/live-agent-registry.ts:12`

## D308

> Defaults (ADR D308): `maxAgents: 100`, `idleTimeoutMs: 30 min`, sweep `60s`.

Cited at 1 site:

- `src/internal/runtime/registry/live-agent-registry.ts:14`

## D309

> Dispose + notify with errors swallowed (D309). Single chokepoint. */

Cited at 2 sites:

- `src/internal/runtime/registry/live-agent-registry.ts:149`
- `src/internal/runtime/registry/live-agent-registry.ts:264`

## D310

> Live-agent cache for production deploys (Production-Readiness #2, ADRs D307-D310).

Cited at 5 sites:

- `src/agent.ts:77`
- `src/index.ts:200`
- `src/internal/runtime/registry/live-agent-registry.ts:2`
- `src/internal/runtime/registry/live-agent-registry.ts:111`
- `src/internal/runtime/registry/live-agent-registry.ts:283`

## D311

> D311: most AgentRunErrors are not retriable (auth, validation, abort).

Cited at 3 sites:

- `src/errors.ts:34`
- `src/errors.ts:320`
- `src/errors.ts:332`

## D312

> D312: provider's `Retry-After` header in **milliseconds**. Mappers store

Cited at 1 site:

- `src/errors.ts:341`

## D313

> D313 + T1.5: alias for `metadata.raw`. Provider response body for

Cited at 1 site:

- `src/errors.ts:354`

## D314

> Provider mappers (D314) override per-status — explicit `retriable` wins

Cited at 2 sites:

- `src/errors.ts:321`
- `src/internal/error-mappers/shared.ts:89`

## D315

> Production-Readiness #4 (ADRs D315-D317): tool lifecycle observability

Cited at 5 sites:

- `src/internal/agent-loop/tool-dispatch.ts:300`
- `src/internal/agent-loop/types.ts:149`
- `src/internal/local-agent/real-local-run.ts:327`
- `src/types/agent.ts:644`
- `src/types/agent.ts:676`

## D317

> `attempt` is always `1` in v1 (D317 — reserved for future retry policy).

Cited at 6 sites:

- `src/internal/agent-loop/tool-dispatch.ts:300`
- `src/internal/agent-loop/tool-dispatch.ts:462`
- `src/internal/agent-loop/types.ts:149`
- `src/internal/local-agent/real-local-run.ts:327`
- `src/types/agent.ts:644`
- `src/types/agent.ts:679`

## D318

> Production-Readiness #5 (ADR D318): caller-supplied `AbortSignal` from

Cited at 2 sites:

- `src/internal/agent-loop/types.ts:107`
- `src/internal/local-agent/real-local-run.ts:302`

## D319

> D319: lifecycle AbortController fired on `dispose()`. Composed with the

Cited at 2 sites:

- `src/internal/local-agent/local-agent-lifecycle.ts:108`
- `src/internal/local-agent/local-agent.ts:133`

## D322

> Production-Readiness #6 — quota / abuse gates (ADRs D322-D323).

Cited at 1 site:

- `src/types/agent.ts:617`

## D323

> Production-Readiness #6 — quota / abuse gates (ADRs D322-D323).

Cited at 1 site:

- `src/types/agent.ts:617`

## D324

> `AbortSignal` composition helpers (Production-Readiness #5 / EC-5, ADR D324).

Cited at 1 site:

- `src/internal/runtime/concurrency/abort-utils.ts:2`

## D361

> Public type contract for the Task observability registry (ADRs D361-D374).

Cited at 4 sites:

- `src/index.ts:29`
- `src/task.ts:3`
- `src/task.ts:76`
- `src/types/task.ts:2`

## D362

> a closed 5-state lifecycle (D362), discriminated events (D366), and a

Cited at 3 sites:

- `src/task.ts:7`
- `src/types/task.ts:6`
- `src/types/task.ts:14`

## D363

> Every fire registers as a Task (ADRs D363/D374) so callers observe it via

Cited at 8 sites:

- `src/batch.ts:102`
- `src/internal/cron/fire-handler.ts:4`
- `src/internal/local-agent/local-agent.ts:346`
- `src/task.ts:9`
- `src/types/batch.ts:69`
- `src/types/run.ts:446`
- `src/types/workflow.ts:408`
- `src/workflow.ts:406`

## D364

> subscribe. Wraps the pluggable `TaskStore` (D364), the `AsyncSemaphore`

Cited at 8 sites:

- `src/internal/task/registry.ts:3`
- `src/internal/task/store.ts:2`
- `src/internal/task/store.ts:207`
- `src/internal/task/store.ts:378`
- `src/task-store.ts:4`
- `src/task.ts:83`
- `src/types/task.ts:7`
- `src/types/task.ts:135`

## D365

> Result of `Task.cancel` (D365 — idempotent). */

Cited at 2 sites:

- `src/task.ts:138`
- `src/types/task.ts:140`

## D366

> a closed 5-state lifecycle (D362), discriminated events (D366), and a

Cited at 3 sites:

- `src/internal/task/registry.ts:327`
- `src/types/task.ts:6`
- `src/types/task.ts:25`

## D367

> Idempotency (D367):** submitting twice with the same `id` returns

Cited at 3 sites:

- `src/internal/task/registry.ts:326`
- `src/internal/task/registry.ts:347`
- `src/task.ts:101`

## D368

> The task id namespace `cron-{jobId}-{fireEpochMs}` honors D368/EC-5.

Cited at 12 sites:

- `src/batch.ts:103`
- `src/errors.ts:554`
- `src/internal/cron/fire-handler.ts:18`
- `src/internal/task/registry.ts:324`
- `src/internal/task/store.ts:11`
- `src/task.ts:104`
- `src/types/batch.ts:80`
- `src/types/run.ts:454`
- `src/types/task.ts:114`
- `src/types/task.ts:147`
- `src/types/task.ts:155`
- `src/types/workflow.ts:409`

## D369

> (D367), runs work under semaphore (D369/EC-11 reentrant bypass),

Cited at 3 sites:

- `src/internal/task/registry.ts:4`
- `src/internal/task/registry.ts:326`
- `src/task.ts:84`

## D370

> D370: Task wrapping is local-only in v1 (cloud runtime pre-release).

Cited at 3 sites:

- `src/errors.ts:594`
- `src/internal/cloud-agent/cloud-agent.ts:154`
- `src/types/run.ts:459`

## D371

> OTel telemetry for the Task registry (ADR D371).

Cited at 1 site:

- `src/internal/task/telemetry.ts:2`

## D372

> D372 — flag set on the first yielded event when the ring buffer was at cap. */

Cited at 5 sites:

- `src/internal/task/registry.ts:4`
- `src/internal/task/ring-buffer.ts:2`
- `src/internal/task/subscribe.ts:2`
- `src/task.ts:153`
- `src/types/task.ts:33`

## D373

> evicted, never submitted, or evicted after retention (D373).

Cited at 2 sites:

- `src/errors.ts:575`
- `src/task.ts:84`

## D374

> Public type contract for the Task observability registry (ADRs D361-D374).

Cited at 11 sites:

- `src/batch.ts:102`
- `src/index.ts:29`
- `src/internal/cron/fire-handler.ts:4`
- `src/internal/local-agent/local-agent.ts:346`
- `src/task.ts:3`
- `src/types/batch.ts:69`
- `src/types/run.ts:446`
- `src/types/task.ts:2`
- `src/types/task.ts:22`
- `src/types/workflow.ts:408`
- `src/workflow.ts:406`

## D375

> Token budget + cost tracker (Adoption Roadmap gap #1 post-Tasks; ADRs D375-D388)

Cited at 4 sites:

- `src/budget.ts:3`
- `src/budget.ts:59`
- `src/index.ts:30`
- `src/types/budget.ts:3`

## D376

> D376: cache + reasoning buckets via OpenRouter passthrough + OpenAI native.

Cited at 17 sites:

- `src/internal/agent-loop/types.ts:255`
- `src/internal/agent-loop/usage-and-cost.ts:2`
- `src/internal/agent-loop/usage-and-cost.ts:31`
- `src/internal/agent-loop/usage-and-cost.ts:58`
- `src/internal/budget/usage-accumulator.ts:3`
- `src/internal/llm/openai.ts:104`
- `src/internal/llm/openai.ts:346`
- `src/internal/llm/openai.ts:501`
- `src/internal/llm/types.ts:215`
- `src/internal/llm/types.ts:217`
- `src/internal/llm/types.ts:219`
- `src/internal/local-agent/real-local-run.ts:566`
- `src/internal/runtime/fixtures/fixture-run-base.ts:300`
- `src/internal/runtime/fixtures/types.ts:32`
- `src/types/run.ts:143`
- `src/types/usage.ts:2`
- `src/types/usage.ts:12`

## D377

> (repo ADR `D377-cost-status-closed-enum.md`): `amountUsd` is `number | undefined`

Cited at 10 sites:

- `src/internal/agent-loop/types.ts:262`
- `src/internal/agent-loop/types.ts:264`
- `src/internal/agent-loop/usage-and-cost.ts:2`
- `src/internal/budget/compute-cost.ts:3`
- `src/internal/local-agent/real-local-run.ts:566`
- `src/internal/runtime/fixtures/fixture-run-base.ts:300`
- `src/internal/runtime/fixtures/types.ts:38`
- `src/messages.ts:46`
- `src/types/run.ts:156`
- `src/types/usage.ts:34`

## D378

> same unit as D378). Provenance marked "catalog-vendored" so CostBreakdown stays honest about the source.

Cited at 3 sites:

- `src/internal/budget/compute-cost.ts:3`
- `src/internal/budget/pricing-registry.ts:7`
- `src/internal/budget/pricing-registry.ts:145`

## D379

> Public type contract for token usage + cost tracking (ADRs D376-D379).

Cited at 2 sites:

- `src/internal/budget/pricing-registry.ts:2`
- `src/types/usage.ts:2`

## D382

> (ADRs D375, D382-D387). The runtime facade lives in `budget.ts`.

Cited at 3 sites:

- `src/internal/budget/calendar-window.ts:2`
- `src/types/budget.ts:3`
- `src/types/budget.ts:16`

## D383

> Default `mode` is `"warn"` (D383). For emergency stop, use

Cited at 4 sites:

- `src/budget.ts:73`
- `src/internal/budget/enforcement.ts:2`
- `src/types/budget.ts:24`
- `src/types/budget.ts:70`

## D384

> A single limit; stacked in an array (D384, ANY exceeded blocks). */

Cited at 2 sites:

- `src/budget.ts:69`
- `src/types/budget.ts:32`

## D385

> In-process Budget ledger (ADR D385).

Cited at 2 sites:

- `src/internal/budget/ledger.ts:2`
- `src/internal/budget/registry.ts:3`

## D386

> Thrown by `Budget` enforcement (ADR D386) when a `mode: "block"`

Cited at 2 sites:

- `src/errors.ts:617`
- `src/internal/budget/enforcement.ts:2`

## D387

> (ADRs D375, D382-D387). The runtime facade lives in `budget.ts`.

Cited at 1 site:

- `src/types/budget.ts:3`

## D388

> Thrown when a budget operation is requested on a `CloudAgent` (D388). The cloud budget surface

Cited at 3 sites:

- `src/budget.ts:3`
- `src/errors.ts:677`
- `src/index.ts:30`

## D422

> Per ADR D422 (Form 4 Hybrid). Hosts registered {@link SubscriptionDescriptor}

Cited at 4 sites:

- `src/index.ts:302`
- `src/internal/local-agent/real-local-run.ts:564`
- `src/subscription/index.ts:4`
- `src/subscription/internal/subscription-runtime.ts:4`

## D423

> Per ADRs D423 (resume token opaque), D424 (transport selection),

Cited at 4 sites:

- `src/subscription/theokit-subscribe.ts:5`
- `src/subscription/types.ts:4`
- `src/subscription/types.ts:33`
- `src/subscription/types.ts:73`

## D424

> stay symmetric across transports. Per ADR D424 the WS payload is JSON-encoded.

Cited at 3 sites:

- `src/subscription/internal/subscription-runtime.ts:24`
- `src/subscription/theokit-subscribe.ts:4`
- `src/subscription/types.ts:4`

## D425

> Per ADR D425. Canonical v1.7.0 adapter — wraps `ws.WebSocketServer({ noServer: true })`

Cited at 4 sites:

- `src/subscription/internal/types.ts:4`
- `src/subscription/internal/ws-adapter-node.ts:4`
- `src/subscription/types.ts:16`
- `src/theokit.ts:182`

## D426

> Per ADR D426 — handler is `AsyncGenerator<TOutput | TrackedEnvelope<TOutput>>`.

Cited at 3 sites:

- `src/subscription/define-subscription.ts:4`
- `src/subscription/define-subscription.ts:41`
- `src/subscription/types.ts:5`

## D427

> Per ADR D427 (Theokit.subscribe namespace) + D424 (transport selection)

Cited at 1 site:

- `src/subscription/theokit-subscribe.ts:4`

## D428

> Per ADR D428 (W3C wire format, independent of D38 a peer vendor AI Data Stream).

Cited at 2 sites:

- `src/subscription/internal/sse-encoder.ts:4`
- `src/subscription/internal/sse-parser.ts:4`

## D429

> — same pattern as `path-safety` per ADR D425/D429 + see tsup.config.ts

Cited at 4 sites:

- `src/index.ts:302`
- `src/subscription/index.ts:4`
- `src/subscription/internal/server-integration.ts:4`
- `src/theokit.ts:182`

## D431

> T3.1 / Cycle #8 of plan `arch-review-fixes-2026-06-06` (ADR D431):**

Cited at 2 sites:

- `src/internal/runtime/registry/agent-registry-contract.ts:6`
- `src/internal/runtime/registry/agent-registry.ts:15`

## D432

> Plan-vs-reality:** the plan (ADR D432) prescribed a full port-and-adapter

Cited at 2 sites:

- `src/internal/session/types.ts:5`
- `src/internal/session/types.ts:16`

## D433

> (ADR D433):** the previous layout had `index-manager.ts` defining the

Cited at 2 sites:

- `src/internal/memory/index-manager-contract.ts:10`
- `src/internal/memory/index-manager.ts:52`

## D435

> SE45 / D435 — the ToolResultGuardOptions CONTRACT type now lives in `types/run.ts`

Cited at 2 sites:

- `src/internal/agent-loop/tool-result-guard.ts:19`
- `src/types/run.ts:11`

## D438

> T4.1 / D438 — `ActiveMemoryResult` and its helpers moved to `./active-memory-types.ts`

Cited at 13 sites:

- `src/internal/memory/active-memory-cache.ts:3`
- `src/internal/memory/active-memory-types.ts:7`
- `src/internal/memory/active-memory.ts:6`
- `src/internal/memory/active-memory.ts:35`
- `src/internal/telemetry/span-names.ts:14`
- `src/types/agent-prims.ts:5`
- `src/types/agent.ts:8`
- `src/types/agent.ts:370`
- `src/types/conversation.ts:3`
- `src/types/messages-base.ts:5`
- `src/types/messages.ts:1`
- `src/types/run.ts:1`
- `src/types/updates.ts:1`

## D440

> ─── Default summarizer (the ADR-D440 subsystem's first real caller) ─────────────────────────────

Cited at 14 sites:

- `src/internal/runtime/compression/compression-attempt.ts:2`
- `src/internal/runtime/compression/compression-attempt.ts:79`
- `src/internal/runtime/compression/compression-config.ts:2`
- `src/internal/runtime/compression/compression-config.ts:55`
- `src/internal/runtime/compression/compression-decision.ts:2`
- `src/internal/runtime/compression/compression-decision.ts:28`
- `src/internal/runtime/compression/compression-model-registry.ts:2`
- `src/internal/runtime/compression/compression-summarizer.ts:2`
- `src/internal/runtime/compression/compression-summarizer.ts:13`
- `src/internal/runtime/compression/compression-summarizer.ts:31`
- `src/internal/session/compact-session.ts:14`
- `src/internal/session/compact-session.ts:174`
- `src/internal/session/compact-session.ts:177`
- `src/internal/session/compact-session.ts:179`

## D447

> Dynamic catalog — 40+ providers from JSON (T10.1, ADR D447)

Cited at 2 sites:

- `src/internal/providers/builtin/index.ts:66`
- `src/internal/providers/catalog-loader.ts:2`

## D449

> Arize Phoenix OTel adapter (T10.2, ADR D449). Detects `arize-phoenix-otel`

Cited at 4 sites:

- `src/internal/telemetry/adapters/arize.ts:4`
- `src/internal/telemetry/adapters/braintrust.ts:4`
- `src/internal/telemetry/adapters/datadog.ts:4`
- `src/internal/telemetry/adapters/langsmith.ts:4`

## D450

> BoundedBuffer — backpressure primitive for subscription streams (T10.3, ADR D450).

Cited at 1 site:

- `src/subscription/internal/backpressure.ts:2`

## D451

> WorkflowScheduler — cron-based trigger for evented workflows (T11.2, ADR D451).

Cited at 2 sites:

- `src/internal/workflow/evented-executor.ts:3`
- `src/internal/workflow/scheduler.ts:2`

## D453

> AgentMailbox — per-agent inbox for A2A communication (T20.1, ADR D453).

Cited at 4 sites:

- `src/a2a/agent-mailbox.ts:2`
- `src/a2a/index.ts:2`
- `src/a2a/message-bus.ts:2`
- `src/a2a/types.ts:2`

## D454

> Client sub-path barrel (T20.2, ADR D454).

Cited at 3 sites:

- `src/client/index.ts:2`
- `src/client/theokit-client.ts:3`
- `src/client/types.ts:2`
