/**
 * Normalize `serveAcp({ agent })` into a uniform `AgentFactory` (D351).
 *
 * - Function input → passed through as-is.
 * - SDKAgent instance → wrapped in a memoized factory + one-time stderr warning
 *   (single shared agent defeats per-session isolation).
 * - Anything else → ConfigurationError thrown synchronously.
 *
 * @internal
 */

import type { SDKAgent } from "@usetheo/sdk";
import type { AgentFactory, AgentOrFactory } from "./types.js";

function looksLikeSDKAgent(value: unknown): value is SDKAgent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { agentId?: unknown }).agentId === "string" &&
    typeof (value as { send?: unknown }).send === "function"
  );
}

export class InvalidAgentError extends Error {
  override readonly name = "InvalidAgentError";
}

interface ResolverOptions {
  log?: (msg: string) => void;
}

export function resolveAgentFactory(
  input: AgentOrFactory,
  options: ResolverOptions = {},
): AgentFactory {
  const log = options.log ?? ((msg: string) => process.stderr.write(`${msg}\n`));

  if (typeof input === "function") {
    return input as AgentFactory;
  }

  if (looksLikeSDKAgent(input)) {
    let warned = false;
    return (_sessionId: string): SDKAgent => {
      if (!warned) {
        warned = true;
        log(
          "[acp] WARN: serveAcp received a single SDKAgent instance; sessions will share conversation state. " +
            "Pass a factory (sessionId) => Agent.create(...) for per-session isolation (D351).",
        );
      }
      return input;
    };
  }

  throw new InvalidAgentError(
    "serveAcp({ agent }) must receive an SDKAgent or a factory (sessionId) => SDKAgent | Promise<SDKAgent>",
  );
}
