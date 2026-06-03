/**
 * `@theokit/acp` — Agent Client Protocol (ACP) server adapter for `@theokit/sdk`.
 *
 * Public API:
 *   - `serveAcp({ agent })` — blocks on stdio JSON-RPC until disconnect (D356).
 *   - `AcpServerOptions`, `AgentFactory`, `PermissionMode`, `PromptTooLargeError`.
 *
 * Spec: https://agentclientprotocol.com
 * ADRs: D349-D360. Plan: `.claude/knowledge-base/plans/acp-server-adapter-plan.md`.
 *
 * @packageDocumentation
 */

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
