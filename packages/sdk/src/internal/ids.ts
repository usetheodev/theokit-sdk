import { randomUUID } from "node:crypto";

/**
 * Stable prefixes that drive runtime auto-detection in `Agent.resume()`,
 * `Agent.get()`, etc. See `.claude/quality-gates.md` and docs.md.
 *
 * @internal
 */
const PREFIX = {
  localAgent: "agent-",
  cloudAgent: "bc-",
  run: "run-",
  call: "call-",
  cron: "cron-",
  request: "request-",
} as const;

/**
 * Generate a local-runtime agent ID. Format: `agent-<uuid>`.
 *
 * @internal
 */
export function generateLocalAgentId(): string {
  return `${PREFIX.localAgent}${randomUUID()}`;
}

/**
 * Generate a cloud-runtime agent ID. Format: `bc-<uuid>`.
 *
 * @internal
 */
export function generateCloudAgentId(): string {
  return `${PREFIX.cloudAgent}${randomUUID()}`;
}

/**
 * Generate a run ID. Format: `run-<uuid>`.
 *
 * @internal
 */
export function generateRunId(): string {
  return `${PREFIX.run}${randomUUID()}`;
}

/**
 * Generate a tool-call ID. Format: `call-<uuid>`.
 *
 * @internal
 */
export function generateCallId(): string {
  return `${PREFIX.call}${randomUUID()}`;
}

/**
 * Generate a cron job ID. Format: `cron-<uuid>`.
 *
 * @internal
 */
export function generateCronId(): string {
  return `${PREFIX.cron}${randomUUID()}`;
}

/**
 * Generate a user-input/approval request ID. Format: `request-<uuid>`.
 *
 * @internal
 */
export function generateRequestId(): string {
  return `${PREFIX.request}${randomUUID()}`;
}

/**
 * Detect whether an agent ID belongs to the local runtime.
 *
 * @internal
 */
export function isLocalAgentId(id: string): boolean {
  return id.startsWith(PREFIX.localAgent);
}

/**
 * Detect whether an agent ID belongs to the cloud runtime.
 *
 * @internal
 */
export function isCloudAgentId(id: string): boolean {
  return id.startsWith(PREFIX.cloudAgent);
}
