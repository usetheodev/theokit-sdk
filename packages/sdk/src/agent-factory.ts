import { Agent } from "./agent.js";
import type { AgentOptions, SDKAgent } from "./types/agent.js";

/**
 * Handle returned by {@link createAgentFactory}. See ADR D23 for merge
 * semantics.
 *
 * @public
 */
export interface AgentFactory {
  /**
   * Create a fresh agent for this session. Equivalent to `Agent.create(merged)`
   * where `merged` is `common` ⊕ `overrides` ⊕ `{ agentId }`.
   */
  forSession(agentId: string, overrides?: Partial<AgentOptions>): Promise<SDKAgent>;
  /**
   * Resume an existing agent for this session, or create one if the ID is
   * unknown. Equivalent to `Agent.getOrCreate(agentId, merged)`.
   */
  getOrCreate(agentId: string, overrides?: Partial<AgentOptions>): Promise<SDKAgent>;
}

/**
 * Capture a common {@link AgentOptions} prefix and produce per-session agents
 * with focused overrides. Useful for chat-bot patterns where most config is
 * shared across users/sessions.
 *
 * Merge rules (ADR D23):
 * - Top-level shallow merge with `overrides` winning.
 * - Deep merge for `local`, `memory`, `cloud` (configuration objects with
 *   non-conflicting flat keys).
 * - Total replace for `mcpServers`, `agents`, `tools`, `providers`,
 *   `plugins`, `skills`, `context` (collection-shaped).
 * - The function-level `agentId` always wins over both `common.agentId` and
 *   `overrides.agentId`.
 *
 * The factory holds `common` by reference — mutating it after construction
 * leaks to subsequent `forSession` calls (documented caveat).
 *
 * @public
 */
export function createAgentFactory(common: Partial<AgentOptions>): AgentFactory {
  return {
    forSession: (agentId, overrides) => Agent.create(mergeAgentOptions(common, overrides, agentId)),
    getOrCreate: (agentId, overrides) =>
      Agent.getOrCreate(agentId, mergeAgentOptions(common, overrides, agentId)),
  };
}

/**
 * Merge factory `common` config with per-session `overrides`, forcing the
 * function-level `agentId`. Deep-merges the 3 configuration-shaped fields
 * (`local`, `memory`, `cloud`); replaces collection-shaped fields.
 *
 * @internal
 */
function mergeAgentOptions(
  common: Partial<AgentOptions>,
  overrides: Partial<AgentOptions> | undefined,
  agentId: string,
): AgentOptions {
  const o = overrides ?? {};
  const merged: Partial<AgentOptions> = { ...common, ...o };
  const local = deepMergeLocal(common.local, o.local);
  if (local !== undefined) merged.local = local;
  const memory = deepMergeMemory(common.memory, o.memory);
  if (memory !== undefined) merged.memory = memory;
  const cloud = deepMergeCloud(common.cloud, o.cloud);
  if (cloud !== undefined) merged.cloud = cloud;
  merged.agentId = agentId;
  return merged as AgentOptions;
}

function deepMergeLocal(
  base: AgentOptions["local"],
  top: AgentOptions["local"],
): AgentOptions["local"] | undefined {
  if (base === undefined && top === undefined) return undefined;
  return { ...(base ?? {}), ...(top ?? {}) };
}

function deepMergeMemory(
  base: AgentOptions["memory"],
  top: AgentOptions["memory"],
): AgentOptions["memory"] | undefined {
  if (base === undefined && top === undefined) return undefined;
  return {
    ...(base ?? {}),
    ...(top ?? {}),
    enabled: top?.enabled ?? base?.enabled ?? false,
  };
}

function deepMergeCloud(
  base: AgentOptions["cloud"],
  top: AgentOptions["cloud"],
): AgentOptions["cloud"] | undefined {
  if (base === undefined && top === undefined) return undefined;
  return { ...(base ?? {}), ...(top ?? {}) };
}
