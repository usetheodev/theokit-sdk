/**
 * Internal DI seam for the public `Agent` facade.
 *
 * Several internal subsystems (`LocalAgent.runUntil`/`fork`, eval, scorers,
 * cron) need to invoke `Agent.create`/`prompt`/`get`/`resume`/`batch`. A direct
 * `import { Agent }` would invert the public-api -> internal dependency
 * direction (and `agent.ts` already imports much of `internal/`). This module
 * is the inversion seam: `agent.ts` registers the facade at module-init time;
 * internal consumers read it on-demand via `getAgentFacade()`. The
 * `internal-must-not-import-facade` dependency-cruiser rule enforces that no
 * `internal/*` module bypasses this seam with a direct facade import.
 *
 * Throws if accessed before registration — should never happen because
 * `agent.ts` evaluation always precedes any internal call (the consumer must
 * obtain a handle from the `Agent` facade first).
 *
 * @internal
 */

import type { AgentOptions, SDKAgent, SDKAgentInfo } from "../../../types/agent.js";
import type { BatchItem, BatchOptions, BatchResult } from "../../../types/batch.js";
import type { RunResult } from "../../../types/run.js";

/**
 * The subset of the public `Agent` static surface that internal subsystems
 * consume through the inversion seam. Each member mirrors the matching
 * `Agent.*` signature so registration is a thin pass-through.
 *
 * @internal
 */
export interface AgentFacadePort {
  create: (options: AgentOptions) => Promise<SDKAgent>;
  prompt: (message: string, options: AgentOptions) => Promise<RunResult>;
  get: (agentId: string) => Promise<SDKAgentInfo>;
  resume: (agentId: string, options?: Partial<AgentOptions>) => Promise<SDKAgent>;
  batch: (
    prompts: ReadonlyArray<string | BatchItem>,
    options: BatchOptions,
  ) => Promise<BatchResult[]>;
}

let registered: AgentFacadePort | undefined;

/**
 * Registered by `agent.ts` at module-init time. Idempotent: re-registration
 * replaces the previous reference (useful for tests that swap implementations).
 *
 * @internal
 */
export function setAgentFacade(facade: AgentFacadePort): void {
  registered = facade;
}

/**
 * Resolve the registered `Agent` facade for internal subsystems.
 *
 * @internal
 */
export function getAgentFacade(): AgentFacadePort {
  if (registered === undefined) {
    throw new Error(
      "internal: Agent facade not registered. The `agent.ts` module must be loaded before internal subsystems (LocalAgent.runUntil/fork, eval, scorers, cron) invoke it.",
    );
  }
  return registered;
}
