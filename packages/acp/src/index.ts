/**
 * `@theokit/acp` — serve an `@theokit/sdk` agent to any ACP-compatible host over stdio JSON-RPC.
 *
 * ```ts
 * import { serveAcp } from "@theokit/acp";
 * import { Agent } from "@theokit/sdk";
 *
 * // One agent per ACP session — this is the shape you want.
 * await serveAcp({ agent: (sessionId) => Agent.create({ agentId: sessionId }) });
 * ```
 *
 * Needs two peer dependencies installed by the consumer, neither of them bundled:
 * `@agentclientprotocol/sdk` (`^0.22.1`) and `@theokit/sdk`. Beyond that this package reads no
 * environment variable and no file — whatever the agent itself needs (provider keys, `THEOKIT_HOME`)
 * is still the caller's job.
 *
 * **stdout is the protocol channel.** A `console.log` anywhere in the agent or its tools writes into
 * the JSON-RPC frame stream and desynchronises the host. Diagnostics from this package go to stderr;
 * override with `AcpServerOptions.log`.
 *
 * Public surface: `serveAcp`, the option types, and the two errors it can produce —
 * `InvalidAgentError` (startup) and `PromptTooLargeError` (per prompt). Everything else (lifecycle
 * handlers, translator, permission plugin, session store) is internal and may change without a
 * major bump.
 *
 * Spec: https://agentclientprotocol.com
 * ADRs: D349-D360. Plan: `.claude/knowledge-base/plans/acp-server-adapter-plan.md`.
 *
 * @packageDocumentation
 */

// #369 — exported for the same reason `PromptTooLargeError` is: it is a failure a consumer is
// expected to branch on, and without the class the only way to recognise it is matching `err.name`.
export { InvalidAgentError } from "./agent-resolver.js";
export { serveAcp } from "./serve.js";
export type {
  AcpAgentInfo,
  AcpCapabilities,
  AcpServerOptions,
  AgentFactory,
  AgentOrFactory,
  PermissionMode,
} from "./types.js";
export { PromptTooLargeError } from "./types.js";
