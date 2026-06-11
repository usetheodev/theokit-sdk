# SDK Public API Inventory (baseline for docs-site plan)

> Date: 2026-05-23
> Source: `grep -E "^export" packages/sdk/src/{index,errors,cron}.ts`
> Purpose: baseline for T0.2 + T8.1 drift check. Symbols listed here MUST have `reference/<name>.mdx` after Phase 4.

## Classes (16)

| Symbol | Source | Concept |
|---|---|---|
| `Agent` | `agent.ts` | concepts/agent.mdx |
| `AgentBuilder` | `agent-builder.ts` | concepts/agent.mdx |
| `Cron` | `cron.ts` | concepts/cron.mdx |
| `Eval` | `eval.ts` | concepts/eval.mdx |
| `Handoff` | `handoffs/index.ts` (barrel) | concepts/handoffs.mdx |
| `Cache` | `cache.ts` | concepts/cache.mdx |
| `Workflow` | `workflow.ts` | concepts/workflows.mdx |
| `WorkflowBuilder` | `workflow.ts` | concepts/workflows.mdx |
| `Memory` | `memory.ts` | concepts/memory.mdx |
| `Theokit` | `theokit.ts` | concepts/agent.mdx (sub) |
| `Scorers` | `scorers.ts` | concepts/eval.mdx |
| `Security` | `security.ts` | concepts/security.mdx |
| `TheokitAgentError` (+ 11 subclasses) | `errors.ts` | concepts/errors.mdx |

## Error classes (12 total — subtree of TheokitAgentError)

- `TheokitAgentError` (base)
- `AuthenticationError`
- `RateLimitError`
- `ConfigurationError`
- `IntegrationNotConnectedError` (extends ConfigurationError)
- `NetworkError`
- `UnknownAgentError`
- `AgentRunError`
- `UnsupportedRunOperationError`
- `CredentialPoolExhaustedError`
- `MemoryAdapterError`
- Plus feature-specific: `EvalAlreadyRunningError`, `GenerateObjectError`, `HandoffLoopError`, `HandoffNameCollisionError`, `HandoffPairLoopError`, `HandoffReceiverDisposedError`, `HandoffSelfReferenceError`, `CacheEmbedderError`, `CacheInvalidTtlError`, `WorkflowAlreadyRunningError`, `WorkflowCompensateNotImplementedError`, `WorkflowDuplicateStepIdError`, `WorkflowMaxIterationsExceededError`, `WorkflowNotSerializableError`, `WorkflowParallelError`, `WorkflowResumeStepNotFoundError`, `WorkflowSnapshotNotFoundError`, `StreamObjectError`

## Functions (8)

| Symbol | Source | Concept |
|---|---|---|
| `createAgentFactory` | `agent-factory.ts` | concepts/agent.mdx |
| `defineTool` | `define-tool.ts` | concepts/tools.mdx |
| `definePlugin` | `internal/plugins/types.ts` (re-export) | concepts/plugins.mdx |
| `extractRawId` | `memory-adapter-helpers.ts` | concepts/memory.mdx |
| `mkMemoryId` | `memory-adapter-helpers.ts` | concepts/memory.mdx |
| `migrateSqliteToLance` | `migrate.ts` | concepts/memory.mdx |
| `toShareGptTrajectory` | `trajectory-helpers.ts` | concepts/eval.mdx |

## Types & Interfaces (top-level — sample, see types/index.ts star export)

| Symbol | Source | Concept |
|---|---|---|
| `AgentPromptResult` | `agent.ts` | reference/Agent |
| `AgentFactory` | `agent-factory.ts` | reference/createAgentFactory |
| `DefineToolSpec` | `define-tool.ts` | reference/defineTool |
| `ErrorCode` | `errors.ts` | concepts/errors |
| `ErrorMetadata` | `errors.ts` | concepts/errors |
| `MemoryAdapterErrorCode` | `errors.ts` | concepts/memory |
| `ProviderProfile` | `internal/providers/types.ts` | concepts/providers-bedrock-vertex |
| `TheokitRequestOptions` | `theokit.ts` | reference/Theokit |
| `DreamingSweepOptions`, `DreamingSweepResult` | `memory.ts` | reference/Memory |
| `MigrateOptions`, `MigrateResult` | `migrate.ts` | reference/migrateSqliteToLance |
| `HookName`, `Plugin`, `PluginContext`, `PreToolCallContext`, `PreToolCallDecision` | `internal/plugins/types.ts` | concepts/plugins |
| `PersonalityPreset` | `types/agent.ts` | concepts/agent (sub: personalities) |
| `DeepPartial`, `SDKObjectDelta` | (from `types/index.ts` star export) | concepts/streaming |

Plus a star export `export type * from "./types/index.ts"` — that file re-exports ~30 additional public types (AgentOptions, SDKMessage variants, RunResult, Subagent, ToolDefinition, etc.) consumed by `Agent.create(options)`.

## Summary

| Category | Count |
|---|---|
| Classes | 16 |
| Error classes | ~28 (12 in errors.ts + 16 feature-specific) |
| Functions (top-level) | 8 |
| Types/Interfaces (direct + star) | ~40 |
| **Total public symbols** | **≥ 90** |

## Coverage check (will populate in Phase 4)

| Symbol | Has `reference/*.mdx`? | Has concept link? |
|---|---|---|
| (to populate after T4.2 runs) | | |

## Notes / Gaps detected

1. `Theokit` is exported as a static class with namespaced members (`Theokit.models.list`, `Theokit.me`, `Theokit.repositories.list`). TypeDoc may emit as a single `Theokit.mdx` or split per-method — confirm during T4.2 implementation.
2. Plugin types (`HookName`, `Plugin`, etc.) are re-exported from `internal/plugins/types.ts`. TypeDoc's `excludeInternal: true` may filter these out — explicit re-export in `index.ts` should keep them visible but verify after T4.1.
3. Star export `export type * from "./types/index.ts"` is a transparent re-export. TypeDoc must follow the star — confirm.
4. `Scorers` is a namespace-style class with static methods (`Scorers.exactMatch`, etc.) — same structural pattern as `Theokit`. Both should be handled by the same generator branch.
