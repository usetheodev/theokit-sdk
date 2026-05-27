/**
 * Stream translator: AsyncGenerator<SDKMessage> → ACP `sessionUpdate` notifications
 * (D353, T3.2).
 *
 * Exhaustive switch on `SDKMessage.type` with `never` check. AbortSignal honored
 * between yields. `sessionUpdate` errors are logged + counted; bail after
 * MAX_CONSECUTIVE_SEND_FAILURES (SHOULD-TEST EC-10).
 *
 * @internal
 */

import type * as acp from "@agentclientprotocol/sdk";
import type { SDKMessage } from "@usetheo/sdk";

const MAX_CONSECUTIVE_SEND_FAILURES = 10;

interface TranslateStreamArgs {
  messages: AsyncGenerator<SDKMessage, void>;
  conn: acp.AgentSideConnection;
  sessionId: string;
  signal: AbortSignal;
  log: (msg: string) => void;
  suppressThinking?: boolean;
}

/**
 * Map known tool names to ACP `ToolKind` for nicer UI affordances.
 */
export function toolKind(name: string): acp.ToolKind {
  const n = name.toLowerCase();
  if (n === "read_file" || n === "list_dir" || n === "git_diff" || n === "search_text")
    return "read";
  if (n === "write_file" || n === "apply_patch") return "edit";
  if (n === "run_command" || n === "run_vitest") return "execute";
  if (n === "web_search" || n === "fetch_url") return "fetch";
  return "other";
}

function mapToolStatus(sdkStatus: "running" | "completed" | "error"): acp.ToolCallStatus {
  if (sdkStatus === "completed") return "completed";
  if (sdkStatus === "error") return "failed";
  return "in_progress";
}

function textChunk(text: string): acp.ContentBlock {
  return { type: "text", text };
}

interface SafeSendState {
  consecutiveFailures: number;
  bailed: boolean;
}

async function safeNotify(
  conn: acp.AgentSideConnection,
  sessionId: string,
  update: acp.SessionUpdate,
  state: SafeSendState,
  log: (msg: string) => void,
): Promise<void> {
  if (state.bailed) return;
  try {
    await conn.sessionUpdate({ sessionId, update });
    state.consecutiveFailures = 0;
  } catch (err) {
    state.consecutiveFailures += 1;
    const msg = err instanceof Error ? err.message : String(err);
    log(
      `[acp] sessionUpdate failed (${state.consecutiveFailures}/${MAX_CONSECUTIVE_SEND_FAILURES}): ${msg}`,
    );
    if (state.consecutiveFailures >= MAX_CONSECUTIVE_SEND_FAILURES) {
      state.bailed = true;
      log("[acp] translator bailing — too many consecutive sessionUpdate failures");
    }
  }
}

async function handleAssistant(
  msg: Extract<SDKMessage, { type: "assistant" }>,
  args: TranslateStreamArgs,
  state: SafeSendState,
): Promise<void> {
  for (const content of msg.message.content) {
    if (content.type === "text") {
      await safeNotify(
        args.conn,
        args.sessionId,
        { sessionUpdate: "agent_message_chunk", content: textChunk(content.text) },
        state,
        args.log,
      );
    } else if (content.type === "tool_use") {
      await safeNotify(
        args.conn,
        args.sessionId,
        {
          sessionUpdate: "tool_call",
          toolCallId: content.id,
          title: content.name,
          kind: toolKind(content.name),
          status: "in_progress",
        },
        state,
        args.log,
      );
    }
  }
}

async function handleToolCall(
  msg: Extract<SDKMessage, { type: "tool_call" }>,
  args: TranslateStreamArgs,
  state: SafeSendState,
): Promise<void> {
  const content: acp.ToolCallContent[] = [];
  if (msg.result !== undefined && msg.result !== null) {
    const text = typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
    content.push({ type: "content", content: textChunk(text) });
  }
  await safeNotify(
    args.conn,
    args.sessionId,
    {
      sessionUpdate: "tool_call_update",
      toolCallId: msg.call_id,
      status: mapToolStatus(msg.status),
      ...(content.length > 0 ? { content } : {}),
    },
    state,
    args.log,
  );
}

async function handleThinking(
  msg: Extract<SDKMessage, { type: "thinking" }>,
  args: TranslateStreamArgs,
  state: SafeSendState,
): Promise<void> {
  if (args.suppressThinking === true) return;
  await safeNotify(
    args.conn,
    args.sessionId,
    { sessionUpdate: "agent_thought_chunk", content: textChunk(msg.text) },
    state,
    args.log,
  );
}

/**
 * Translate the SDK stream into ACP `sessionUpdate` notifications.
 * Exhaustive over `SDKMessage.type` — adding a new variant fails compile.
 */
export async function translateStream(args: TranslateStreamArgs): Promise<void> {
  const state: SafeSendState = { consecutiveFailures: 0, bailed: false };
  for await (const msg of args.messages) {
    if (args.signal.aborted) break;
    if (state.bailed) break;
    await dispatchMessage(msg, args, state);
  }
}

async function dispatchMessage(
  msg: SDKMessage,
  args: TranslateStreamArgs,
  state: SafeSendState,
): Promise<void> {
  switch (msg.type) {
    case "system":
      return; // no ACP equivalent
    case "user":
      return; // echo, no ACP equivalent
    case "assistant":
      await handleAssistant(msg, args, state);
      return;
    case "thinking":
      await handleThinking(msg, args, state);
      return;
    case "tool_call":
      await handleToolCall(msg, args, state);
      return;
    case "status":
      return; // cloud-only
    case "task":
      return; // milestones — skipped in v0.1
    case "request":
      return; // permission requests routed via plugin
    case "object_delta":
      return; // streamObject not used in plain prompt flow
    default: {
      const _exhaustive: never = msg;
      throw new Error(`unhandled SDKMessage type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
