/**
 * Memory hook wiring for `LocalAgent.sendLocked` (T2.1, ADRs D141 / D145).
 *
 * Two helpers extracted to keep `local-agent.ts` under G8 (≤400 LoC):
 *  - `applyPreUserSendHook` — fires `pre_user_send`, caps recalled context
 *    at `maxRecallContextBytes` (EC-A), injects `<memory-context>` fence.
 *  - `wrapRunWithPostReplyHook` — Proxy-wraps the Run so
 *    `post_assistant_reply` fires once after `wait()` (fire-and-forget,
 *    errors → stderr per EC-O).
 *
 * @internal
 */

import type { AgentOptions } from "../../types/agent.js";
import type { Run, SDKUserMessage, SendOptions } from "../../types/run.js";
import type { PluginManager } from "../plugins/manager.js";

const DEFAULT_MAX_RECALL_BYTES = 16_000;

/**
 * EC-A + EC-G + EC-H: fire `pre_user_send` hooks, cap recalled context,
 * and prepend it as a `<memory-context>` fence around the original
 * user text. Returns the (possibly wrapped) message preserving the
 * `string | SDKUserMessage` shape the caller passed in.
 */
export async function applyPreUserSendHook(args: {
  pluginManager: PluginManager;
  agentId: string;
  options: AgentOptions;
  original: string | SDKUserMessage;
  userText: string;
  sendOptions: SendOptions;
}): Promise<string | SDKUserMessage> {
  const handlers = args.pluginManager.hooksFor("pre_user_send");
  if (handlers.length === 0) return args.original;
  const ctx = {
    prompt: args.userText,
    agentId: args.agentId,
    runId: "",
    ...(args.options.memoryContext !== undefined
      ? { memoryContext: args.options.memoryContext }
      : {}),
    ...(args.sendOptions.signal !== undefined ? { signal: args.sendOptions.signal } : {}),
  };
  const cap = args.options.maxRecallContextBytes ?? DEFAULT_MAX_RECALL_BYTES;
  const recalled = await args.pluginManager.runPreUserSendHooks(ctx, cap);
  if (recalled === undefined || recalled.length === 0) return args.original;
  const wrapped = `<memory-context>\n${recalled}\n</memory-context>\n\n${args.userText}`;
  return typeof args.original === "string" ? wrapped : { ...args.original, text: wrapped };
}

/**
 * Wrap a `Run` so `post_assistant_reply` fires once after `wait()`.
 * Fire-and-forget — errors are surfaced to stderr (EC-O) so the caller
 * never blocks on memory sync. Returns a Proxy preserving all other
 * Run methods (stream, cancel, conversation).
 */
export function wrapRunWithPostReplyHook(args: {
  pluginManager: PluginManager;
  agentId: string;
  options: AgentOptions;
  run: Run;
  userText: string;
}): Run {
  const handlers = args.pluginManager.hooksFor("post_assistant_reply");
  if (handlers.length === 0) return args.run;
  const wrappedWait: Run["wait"] = async () => {
    const result = await args.run.wait();
    const replyText = (result as { result?: string }).result ?? "";
    const ctx = {
      prompt: args.userText,
      reply: replyText,
      agentId: args.agentId,
      runId: result.id,
      ...(args.options.memoryContext !== undefined
        ? { memoryContext: args.options.memoryContext }
        : {}),
    };
    // Fire-and-forget; never block the caller.
    void args.pluginManager.runPostAssistantReplyHooks(ctx);
    return result;
  };
  return new Proxy(args.run, {
    get(target, prop, receiver) {
      if (prop === "wait") return wrappedWait;
      return Reflect.get(target, prop, receiver);
    },
  });
}
