/**
 * Public types for `@usetheo/acp` (ADRs D349-D360).
 *
 * @public
 */

import type { SDKAgent } from "@usetheo/sdk";

/**
 * Factory function shape: receives the ACP session id (UUID) and returns
 * a fresh `SDKAgent` for that session. Per D351, this enforces per-session
 * conversation isolation when consumers want it.
 *
 * @public
 */
export type AgentFactory = (sessionId: string) => SDKAgent | Promise<SDKAgent>;

/**
 * Acceptable shapes for `serveAcp({ agent })`:
 *   - `AgentFactory`: per-session isolation (recommended).
 *   - `SDKAgent`: single shared agent — emits one-time stderr warning.
 *
 * @public
 */
export type AgentOrFactory = AgentFactory | SDKAgent;

/**
 * Permission mode controlling how tool calls flow through ACP permission
 * round-trip (D355).
 *
 * @public
 */
export type PermissionMode = "ask" | "auto" | "deny";

/**
 * Capabilities advertised in the ACP `initialize` handshake. Users may
 * override any subset; defaults are loaded internally.
 *
 * @public
 */
export interface AcpCapabilities {
  loadSession?: boolean;
  forkSession?: boolean;
  listSessions?: boolean;
  prompt?: {
    audio?: boolean;
    embeddedContext?: boolean;
    image?: boolean;
  };
}

/**
 * Display info for the agent in the ACP host UI.
 *
 * @public
 */
export interface AcpAgentInfo {
  name: string;
  title?: string;
  version: string;
}

/**
 * Options for `serveAcp()`.
 *
 * @public
 */
export interface AcpServerOptions {
  /** Single agent OR factory `(sessionId) => SDKAgent`. Required. */
  agent: AgentOrFactory;
  /** Display info advertised in `initialize`. Defaults to package metadata. */
  info?: AcpAgentInfo;
  /** Capability overrides for the `initialize` handshake. */
  capabilities?: AcpCapabilities;
  /** Permission mode (default `"ask"`). See D355. */
  permissionDefault?: PermissionMode;
  /** Timeout (ms) for `requestPermission` round-trip before vetoing (default 60_000). EC-2. */
  permissionTimeoutMs?: number;
  /** Tool names that bypass `ask` mode. */
  trustedTools?: ReadonlyArray<string>;
  /** Cap on total prompt bytes (default 2 MiB). D360. */
  maxPromptBytes?: number;
  /** Logger — defaults to `process.stderr.write` per D359. */
  log?: (msg: string) => void;
  /** Override stdin (test seam). */
  stdin?: NodeJS.ReadableStream;
  /** Override stdout (test seam). */
  stdout?: NodeJS.WritableStream;
}

/**
 * Thrown by `extractPrompt` when the decoded prompt exceeds `maxPromptBytes`.
 * Public so callers can `instanceof` it.
 *
 * @public
 */
export class PromptTooLargeError extends Error {
  override readonly name = "PromptTooLargeError";
  constructor(
    readonly size: number,
    readonly limit: number,
  ) {
    super(`prompt exceeds ${limit} bytes (got ${size})`);
  }
}
