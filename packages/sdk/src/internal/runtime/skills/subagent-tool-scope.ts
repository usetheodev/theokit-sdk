import type { AgentDefinition } from "../../../types/agent.js";
import { withToolWhitelist } from "../../concurrency/async-local-storage.js";

/**
 * Resolve a sub-agent's tool whitelist from its {@link AgentDefinition.tools}
 * (M4-6). Returns a `Set` of allowed tool names when `tools` is a non-empty
 * array, else `undefined` (unscoped — the sub-agent inherits the parent's full
 * toolset). The `Set` is the exact shape `withToolWhitelist` /
 * `ForkOptions.allowedTools` consume.
 *
 * @public
 */
export function subagentToolWhitelist(definition: AgentDefinition): Set<string> | undefined {
  const { tools } = definition;
  return Array.isArray(tools) && tools.length > 0 ? new Set(tools) : undefined;
}

/**
 * Run `fn` under the sub-agent's tool whitelist (M4-6). When the definition
 * declares `tools`, the run executes inside `withToolWhitelist(set, fn)` — so
 * every tool call the sub-agent makes is vetoed at dispatch (`checkToolWhitelist`,
 * the same enforcement forks use) unless its canonical name is whitelisted: a
 * `tools: ["read_file"]` sub-agent provably cannot call `write_file`/`shell_exec`.
 * Enforcement is `withToolWhitelist`, NOT `PermissionEngine`.
 *
 * An unscoped definition (no/empty `tools`) runs `fn` directly — the parent's
 * full toolset is preserved.
 *
 * @public
 */
export function withSubagentToolScope<T>(
  definition: AgentDefinition,
  fn: () => Promise<T>,
): Promise<T> {
  const whitelist = subagentToolWhitelist(definition);
  return whitelist ? withToolWhitelist(whitelist, fn) : fn();
}
