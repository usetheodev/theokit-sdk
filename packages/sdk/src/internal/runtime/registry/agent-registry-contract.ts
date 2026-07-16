/**
 * Agent registry contract — leaf types that both `agent-registry.ts`
 * (in-memory + write-through orchestrator) and `agent-registry-store.ts`
 * (persistent disk layer) consume.
 *
 * **T3.1 / Cycle #8 of plan `arch-review-fixes-2026-06-06` (ADR D431):**
 * the previous layout had `agent-registry.ts` importing runtime functions
 * from `agent-registry-store.ts`, and `agent-registry-store.ts` importing
 * the `AgentRuntime` + `RegisteredAgent` types from `agent-registry.ts` —
 * a runtime↔store 2-node cycle (HIGH severity per Phase 5 cartographer).
 * Extracting the shared types to this leaf file breaks the cycle: both
 * files now import from this contract; neither imports from the other for
 * types, and only the orchestrator imports the store's runtime functions.
 *
 * **Contract scope:** types only. No runtime code, no imports from the
 * cycle members. This file is a true leaf — verifiable by `madge --circular`
 * absence of any cycle containing `agent-registry-contract.ts`.
 *
 * @internal — NOT part of the `@theokit/sdk` public API.
 */
import type { AgentOptions, ModelSelection } from "../../../types/agent.js";

/**
 * Whether an agent runs in the local or cloud runtime. Drives storage routing,
 * fork semantics, and the cross-runtime UnsupportedRunOperationError contract
 * (ADR D122).
 */
export type AgentRuntime = "local" | "cloud";

/**
 * In-memory agent registry record. Persisted via the
 * `agent-registry-store.ts` serialization layer (which strips secrets per
 * ADR D17 + D68 — see `stripSecretsFromOptions`).
 */
export interface RegisteredAgent {
  agentId: string;
  runtime: AgentRuntime;
  name?: string;
  summary?: string;
  model?: ModelSelection;
  createdAt: number;
  lastModified: number;
  archived: boolean;
  options: AgentOptions;
  /**
   * Local workspace cwd; only set when runtime is local. Also used as the
   * persistence routing key (cloud agents default to `process.cwd()`).
   */
  cwd?: string;
  /** Cloud repo URLs; only set when runtime is cloud. */
  repos?: string[];
  /** Optional explicit status reported via SDKAgentInfo.status. */
  status?: "running" | "finished" | "error";
}
