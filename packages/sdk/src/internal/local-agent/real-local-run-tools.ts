/**
 * Custom-tool assembly for the real local run (extracted from `real-local-run.ts`
 * for the G8 LoC budget — SRP: everything that builds the effective tool catalog
 * for a run lives here).
 *
 * Merges, in order: caller/agent `tools`, declarative subagent delegation tools
 * (file-based + inline), plugin tools, and — SE37 — the internal `think` tool when
 * `reasoning: true` (guarded against a native reasoning model). Binds parent
 * credentials onto delegation tools and applies the personality whitelist.
 *
 * @internal
 */

import { subAgentToolsFromDefinitions } from "../../a2a/subagent.js";
import type {
  AgentDefinition,
  AgentOptions,
  CustomTool,
  ModelSelection,
} from "../../types/agent.js";
import type { CustomToolSpec } from "../agent-loop/loop-types.js";
import type { InheritedCredentials } from "../runtime/concurrency/subagent-credentials.js";
import { createThinkTool, reasoningActive } from "../runtime/reasoning/native-reasoning.js";
import { applyPersonalityFilter } from "../tool-registry/personality-filter.js";

/**
 * Declarative subagents become delegation tools for the local runtime — each
 * child inherits the parent's apiKey/model (via the run's credential scope) and is
 * scoped to the whitelisted subset of the parent's tools. `agents` is the merged
 * set from `loadSubagents` (`.theokit/agents/*.md` + inline `agentOptions.agents`),
 * so a subagent defined only on disk is callable against a real model — not just
 * in fixture mode.
 */
function declarativeSubagentTools(
  agents: Record<string, AgentDefinition> | undefined,
  parentTools: ReadonlyArray<CustomTool>,
): CustomTool[] {
  if (agents === undefined || Object.keys(agents).length === 0) return [];
  return subAgentToolsFromDefinitions(agents, parentTools);
}

/**
 * The credentials a delegated child inherits from this parent: its apiKey (else `Agent.create`
 * throws "Missing API key"), its model, its plugins and its sandbox posture.
 *
 * theokit#148 — this used to be pushed onto each subagent tool OBJECT
 * (`inheritSubAgentCredentials`), which meant any layer that rebuilt the object dropped it and the
 * child failed with `provider_unresolved`. It is now published on the run's async scope by
 * `createRealLocalRun`, so the value travels with the CALL. This function only computes it; the
 * scope is established at the run boundary, which is also the correct lifetime for it.
 *
 * @internal
 */
export function resolveInheritedCredentials(agentOptions: AgentOptions): InheritedCredentials {
  // #55 — hand the parent's code-registered plugins (array form carries the
  // PermissionPlugin) down so the child runs under the same permission gate.
  const parentPlugins = Array.isArray(agentOptions.plugins) ? agentOptions.plugins : undefined;
  // M33 — hand down the parent's sandbox posture so a child of a sandboxed parent stays sandboxed unless
  // its role opts out. A role's own `sandbox` (spec.sandbox) overrides this in buildChildCreateOptions.
  const parentSandbox = agentOptions.local?.sandboxOptions?.enabled;
  return {
    ...(agentOptions.apiKey !== undefined ? { apiKey: agentOptions.apiKey } : {}),
    ...(typeof agentOptions.model === "object" ? { model: agentOptions.model } : {}),
    ...(parentPlugins !== undefined ? { plugins: parentPlugins } : {}),
    ...(parentSandbox !== undefined ? { sandbox: parentSandbox } : {}),
  };
}

/**
 * Resolve the effective custom-tool catalog for this run.
 *
 * Precedence (matches the mcpServers semantics — "fully replaces, not merged"):
 *  - `sendOptions.tools === undefined` → fall back to `agentOptions.tools`
 *  - `sendOptions.tools = []`         → explicitly clear (no custom tools)
 *  - `sendOptions.tools = [t1, ...]`  → use exactly these for this run
 */
export function buildCustomToolsInput(
  agentOptions: AgentOptions,
  sendOptions: { tools?: CustomTool[] } | undefined,
  pluginManager: import("../plugins/manager.js").PluginManager | undefined,
  personalityToolWhitelist: ReadonlyArray<string> | undefined,
  agentId: string,
  personalityName: string | undefined,
  subagents: Record<string, AgentDefinition> | undefined,
  effectiveModel: ModelSelection | undefined,
): { customTools: ReadonlyArray<CustomToolSpec> } | Record<string, never> {
  const baseTools = sendOptions?.tools ?? agentOptions.tools ?? [];
  // Prefer the resolved set (file-based + inline) when present; fall back to the
  // inline `agentOptions.agents` for callers that don't thread resolvedSubagents.
  const agentsForTools =
    subagents !== undefined && Object.keys(subagents).length > 0 ? subagents : agentOptions.agents;
  const subagentTools = declarativeSubagentTools(agentsForTools, baseTools);
  // T4.1: concat plugin-registered tools onto the effective catalog. Plugin
  // tools are merged unconditionally (no override semantics — name collision
  // would be caught by the registry validator if used).
  const pluginTools = pluginManager?.aggregated.tools ?? [];
  // SE37 — `reasoning: true` auto-attaches the internal `think` tool, unless a
  // native reasoning model is configured (guard + one-time warn). Guards on the
  // EFFECTIVE model (per-send override applied), matching the preamble path in
  // local-assembly so both agree on native-vs-not (no split double-reasoning).
  const reasoningTools = reasoningActive(agentOptions.reasoning, effectiveModel)
    ? [createThinkTool()]
    : [];
  if (
    baseTools.length === 0 &&
    subagentTools.length === 0 &&
    pluginTools.length === 0 &&
    reasoningTools.length === 0
  ) {
    return {};
  }
  const allTools = [...baseTools, ...subagentTools, ...pluginTools, ...reasoningTools];
  // theokit#148 — note this very `map`: the SDK rebuilds each tool from four fields, so any
  // credential channel riding the tool object is dropped right here. It only used to survive
  // because the pre-rebuild sink mutated the original handler's closure. Credentials now travel on
  // the run's async scope, which this rebuild cannot touch.
  const merged: CustomToolSpec[] = allTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    handler: tool.handler,
  }));
  // Phase 4.1 / ADR D167 — advisory narrowing by active personality.
  const customTools = applyPersonalityFilter(merged, personalityToolWhitelist, {
    agentId,
    personalityName,
  }) as ReadonlyArray<CustomToolSpec>;
  if (customTools.length === 0 && personalityToolWhitelist === undefined) return {};
  return { customTools };
}
