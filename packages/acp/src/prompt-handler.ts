/**
 * ACP prompt handler — extracts user text, drives `agent.send`, translates
 * stream via `translator.ts`, returns `PromptResponse` with stop reason.
 *
 * @internal
 */

import type * as acp from "@agentclientprotocol/sdk";
import type { Run } from "@theokit/sdk";
import { ACP_ERR, type AcpError } from "./lifecycle.js";
import { installPermissionPlugin } from "./permission-plugin.js";
import { extractPrompt } from "./prompt-extract.js";
import type { AcpSession, SessionStore } from "./session-store.js";
import { translateStream } from "./translator.js";
import type { PermissionMode } from "./types.js";

interface HandlePromptDeps {
  store: SessionStore;
  conn: acp.AgentSideConnection;
  maxPromptBytes: number;
  permissionMode: PermissionMode;
  permissionTimeoutMs: number;
  trustedTools: Set<string>;
  log: (msg: string) => void;
}

function mapStopReason(runStatus: string, errorCode?: string): acp.StopReason {
  if (errorCode === "aborted" || runStatus === "cancelled") return "cancelled";
  if (errorCode === "safety_blocked") return "refusal";
  if (errorCode === "context_length_exceeded" || errorCode === "max_tokens") return "max_tokens";
  if (errorCode === "max_iterations") return "max_turn_requests";
  if (runStatus === "finished") return "end_turn";
  return "end_turn";
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "AbortError" || err.message.includes("aborted");
}

type ExtractOutcome = { ok: true; text: string } | { ok: false; error: AcpError };

function extractOrError(params: acp.PromptRequest, deps: HandlePromptDeps): ExtractOutcome {
  try {
    const result = extractPrompt(params.prompt, deps.maxPromptBytes);
    if (result.text.length === 0) {
      return { ok: false, error: { code: ACP_ERR.INVALID_REQUEST, message: "empty prompt" } };
    }
    return { ok: true, text: result.text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log(`[acp] prompt extract rejected: ${msg}`);
    return { ok: false, error: { code: ACP_ERR.INVALID_REQUEST, message: msg } };
  }
}

async function runPrompt(
  session: AcpSession,
  text: string,
  params: acp.PromptRequest,
  deps: HandlePromptDeps,
): Promise<acp.StopReason> {
  const run: Run = await session.agent.send(text, { signal: session.abortController.signal });
  try {
    await translateStream({
      messages: run.stream(),
      conn: deps.conn,
      sessionId: params.sessionId,
      signal: session.abortController.signal,
      log: deps.log,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log(`[acp] translator threw mid-stream: ${msg}`);
  }
  const result = await run.wait();
  const errorCode =
    result.status === "error" && result.error !== undefined ? (result.error.code ?? "") : "";
  return mapStopReason(result.status, errorCode);
}

/**
 * SEC-M0-03 — install the permission veto (fail-closed). Returns an AcpError to
 * REFUSE the prompt when the requested mode cannot be enforced on this runtime,
 * or `undefined` when installation succeeded (or mode is `auto`).
 */
async function installPermissionOrError(
  session: AcpSession,
  params: acp.PromptRequest,
  deps: HandlePromptDeps,
): Promise<AcpError | undefined> {
  if (deps.permissionMode === "auto") return undefined;
  try {
    await installPermissionPlugin(session.agent, {
      conn: deps.conn,
      sessionId: params.sessionId,
      mode: deps.permissionMode,
      trustedTools: deps.trustedTools,
      timeoutMs: deps.permissionTimeoutMs,
    });
    return undefined;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { code: ACP_ERR.INTERNAL_ERROR, message: msg };
  }
}

export async function handlePrompt(
  params: acp.PromptRequest,
  deps: HandlePromptDeps,
): Promise<{ response: acp.PromptResponse } | { error: AcpError }> {
  const session = deps.store.get(params.sessionId);
  if (session === undefined) {
    return {
      error: { code: ACP_ERR.INVALID_SESSION, message: `unknown session: ${params.sessionId}` },
    };
  }
  session.lastUsedAt = Date.now();

  const extracted = extractOrError(params, deps);
  if (!extracted.ok) return { error: extracted.error };

  const permError = await installPermissionOrError(session, params, deps);
  if (permError !== undefined) return { error: permError };

  try {
    const stopReason = await runPrompt(session, extracted.text, params, deps);
    return { response: { stopReason } };
  } catch (err) {
    if (isAbortError(err)) return { response: { stopReason: "cancelled" } };
    const msg = err instanceof Error ? err.message : String(err);
    deps.log(`[acp] agent.send threw: ${msg}`);
    return { error: { code: ACP_ERR.INTERNAL_ERROR, message: msg } };
  }
}
