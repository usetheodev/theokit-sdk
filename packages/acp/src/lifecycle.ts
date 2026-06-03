/**
 * ACP lifecycle handlers (D352, D354, EC-1/3/5/6).
 *
 * - handleInitialize: capability advertisement (D353)
 * - handleNewSession: Agent.create via factory (D351)
 * - handleLoadSession: Agent.resume({ agentId: sessionId }) (D352, EC-6)
 * - handleForkSession: agent.fork() (D352, EC-3)
 * - handleListSessions: snapshot of in-memory sessions
 * - handleCancel: fire lifecycle abort (D354)
 *
 * All handlers are pure functions over `(params, deps)`. `serve.ts` wires them.
 *
 * @internal
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import { Agent, type SDKAgent } from "@theokit/sdk";
import type { AcpSession, SessionStore } from "./session-store.js";
import type { AcpCapabilities, AgentFactory } from "./types.js";

// ===== initialize =====

interface InitializeDeps {
  capabilities?: AcpCapabilities;
}

export function buildInitializeResponse(
  _params: acp.InitializeRequest,
  deps: InitializeDeps,
): acp.InitializeResponse {
  const userCaps = deps.capabilities ?? {};
  return {
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: userCaps.loadSession ?? true,
      promptCapabilities: {
        image: userCaps.prompt?.image ?? true,
        audio: userCaps.prompt?.audio ?? false,
        embeddedContext: userCaps.prompt?.embeddedContext ?? true,
      },
    },
    authMethods: [],
  };
}

// ===== newSession =====

interface NewSessionDeps {
  factory: AgentFactory;
  store: SessionStore;
  log: (msg: string) => void;
}

type AcpResult<T> = { ok: true; value: T } | { ok: false; error: AcpError };

export interface AcpError {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON-RPC error codes per ACP spec. */
export const ACP_ERR = {
  INVALID_REQUEST: -32_602,
  INTERNAL_ERROR: -32_603,
  INVALID_SESSION: -32_001,
  AUTH_REQUIRED: -32_002,
} as const;

/**
 * Validate and resolve `params.cwd` to an absolute existing path (EC-5).
 * Returns `Result` so caller can map to ACP error.
 */
function resolveCwdOrError(rawCwd: string | undefined): AcpResult<string> {
  if (typeof rawCwd !== "string" || rawCwd.length === 0) {
    return {
      ok: false,
      error: { code: ACP_ERR.INVALID_REQUEST, message: "cwd is required" },
    };
  }
  const resolved = path.resolve(rawCwd);
  if (!existsSync(resolved)) {
    return {
      ok: false,
      error: { code: ACP_ERR.INVALID_REQUEST, message: `cwd not found: ${resolved}` },
    };
  }
  return { ok: true, value: resolved };
}

export async function handleNewSession(
  params: acp.NewSessionRequest,
  deps: NewSessionDeps,
): Promise<{ response: acp.NewSessionResponse } | { error: AcpError }> {
  const cwdResult = resolveCwdOrError(params.cwd);
  if (!cwdResult.ok) return { error: cwdResult.error };

  const sessionId = randomUUID();
  let agent: SDKAgent;
  try {
    agent = await deps.factory(sessionId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log(`[acp] new_session factory threw: ${msg}`);
    return {
      error: {
        code: ACP_ERR.INTERNAL_ERROR,
        message: `agent factory threw: ${msg}`,
      },
    };
  }

  const session: AcpSession = {
    sessionId,
    agent,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    abortController: new AbortController(),
    cwd: cwdResult.value,
  };
  deps.store.create(session);

  return { response: { sessionId } };
}

// ===== loadSession =====

interface LoadSessionDeps {
  store: SessionStore;
  log: (msg: string) => void;
}

const STORAGE_HINT =
  " — if running on serverless/multi-host infra, pass conversationStorage to Agent.create (see docs/recipes/conversation-storage-postgres.md)";

export async function handleLoadSession(
  params: acp.LoadSessionRequest,
  deps: LoadSessionDeps,
): Promise<{ response: acp.LoadSessionResponse } | { error: AcpError }> {
  const cwdResult = resolveCwdOrError(params.cwd);
  if (!cwdResult.ok) return { error: cwdResult.error };

  if (deps.store.has(params.sessionId)) {
    return {
      error: {
        code: ACP_ERR.INVALID_REQUEST,
        message: `session ${params.sessionId} already loaded`,
      },
    };
  }

  let agent: SDKAgent;
  try {
    agent = await Agent.resume(params.sessionId, { local: { cwd: cwdResult.value } });
  } catch (err) {
    // EC-6: helpful hint for serverless users
    const msg = err instanceof Error ? err.message : String(err);
    deps.log(`[acp] load_session Agent.resume threw for ${params.sessionId}: ${msg}`);
    return {
      error: {
        code: ACP_ERR.INVALID_SESSION,
        message: `session not found: ${params.sessionId}${STORAGE_HINT}`,
      },
    };
  }

  const session: AcpSession = {
    sessionId: params.sessionId,
    agent,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    abortController: new AbortController(),
    cwd: cwdResult.value,
  };
  deps.store.create(session);

  return { response: {} };
}

// ===== forkSession (unstable_forkSession) =====

interface ForkSessionDeps {
  store: SessionStore;
  log: (msg: string) => void;
}

export async function handleForkSession(
  params: acp.ForkSessionRequest,
  deps: ForkSessionDeps,
): Promise<{ response: acp.ForkSessionResponse } | { error: AcpError }> {
  const parent = deps.store.get(params.sessionId);
  if (parent === undefined) {
    return {
      error: {
        code: ACP_ERR.INVALID_SESSION,
        message: `parent session not loaded: ${params.sessionId}`,
      },
    };
  }

  // EC-5: resolve params.cwd if provided; else inherit parent.cwd
  let resolvedCwd = parent.cwd;
  if (typeof params.cwd === "string" && params.cwd.length > 0) {
    const cwdResult = resolveCwdOrError(params.cwd);
    if (!cwdResult.ok) return { error: cwdResult.error };
    resolvedCwd = cwdResult.value;
  }

  // V0.1: ACP `unstable_forkSession` is experimental upstream and our SDK's
  // `agent.fork()` is a one-shot ephemeral sub-run (D110-D114), not a
  // long-lived session split. Returning invalid_request prevents misuse
  // until v0.2 implements proper session forking via Agent.create() with
  // parent options inheritance.
  // (EC-3 still observed: any host that calls this on a CloudAgent gets a
  // clean invalid_request rather than UnsupportedRunOperationError.)
  void parent; // parent lookup kept for symmetry + parentId validation
  void resolvedCwd;
  void deps.log;
  return {
    error: {
      code: ACP_ERR.INVALID_REQUEST,
      message:
        "session/fork is deferred to @theokit/acp v0.2 — current SDK fork is a one-shot sub-run, not a session split",
    },
  };
}

// ===== listSessions =====

export function handleListSessions(
  _params: acp.ListSessionsRequest,
  store: SessionStore,
): acp.ListSessionsResponse {
  const sessions = store.list().map((s) => ({
    sessionId: s.sessionId,
    cwd: s.cwd,
    title: s.agent.agentId,
    lastUpdatedAt: new Date(s.lastUsedAt).toISOString(),
  }));
  return { sessions };
}

// ===== cancel =====

interface CancelDeps {
  store: SessionStore;
}

export function handleCancel(params: acp.CancelNotification, deps: CancelDeps): void {
  const session = deps.store.get(params.sessionId);
  if (session === undefined) return; // idempotent — silently succeed on unknown sessionId
  session.lastUsedAt = Date.now();
  if (!session.abortController.signal.aborted) {
    session.abortController.abort("cancelled by ACP client");
  }
}
