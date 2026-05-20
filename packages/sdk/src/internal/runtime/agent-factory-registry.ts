/**
 * Tiny DI registry for `Agent.create` (T4.2 + T4.3 wiring).
 *
 * `LocalAgent.runUntil` and `LocalAgent.fork` need to spawn auxiliary
 * agents via `Agent.create`. A direct import would form a cycle
 * (`agent.ts` already imports `LocalAgent`). This module is the seam:
 * `agent.ts` registers the factory at module init time; LocalAgent
 * reads it on-demand.
 *
 * Throws if accessed before registration — should never happen because
 * `agent.ts` evaluation always precedes `LocalAgent.runUntil()` calls
 * (the user must call `Agent.create()` to obtain the LocalAgent first).
 *
 * @internal
 */

import type { AgentOptions, SDKAgent } from "../../types/agent.js";

export type AgentCreateFn = (options: AgentOptions) => Promise<SDKAgent>;

let registered: AgentCreateFn | undefined;

/**
 * Registered by `agent.ts` at module-init time. Idempotent: re-registration
 * replaces the previous reference (useful for tests that swap implementations).
 *
 * @internal
 */
export function setAgentCreate(fn: AgentCreateFn): void {
  registered = fn;
}

/**
 * Resolve the registered `Agent.create` for fork/judge auxiliaries.
 *
 * @internal
 */
export function getAgentCreate(): AgentCreateFn {
  if (registered === undefined) {
    throw new Error(
      "internal: Agent.create not registered. The `agent.ts` module must be loaded before LocalAgent.runUntil/fork are invoked.",
    );
  }
  return registered;
}
