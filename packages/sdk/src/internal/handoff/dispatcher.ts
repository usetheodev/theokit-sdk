/**
 * Handoff dispatch orchestration.
 *
 * Pragmatic v1: when a handoff fires, the sender calls `receiver.send()`
 * with the (optionally filtered) history. The receiver's reply is returned
 * to the sender, which captures it as the answer to the user's question.
 *
 * NOTE: this is NOT pure peer-to-peer (the sender stays on the call stack
 * until the receiver returns). Pure intercept-and-swap requires deeper
 * agent-loop refactor; deferred to v2. v1 still validates the user-facing
 * value: "agent A reasoned about routing, agent B answered."
 *
 * @internal
 */

import { z } from "zod";

import { type HandoffChainState, recordHop } from "./registry.js";
import { startHandoffSpan } from "./telemetry.js";
import type { SDKAgent } from "../../types/agent.js";
import type {
  HandoffContext,
  HandoffDescriptor,
  HandoffHistory,
  HandoffResult,
} from "../../types/handoff.js";
import { HandoffReceiverDisposedError } from "../../types/handoff.js";

/**
 * EC-2 / D228 — `safeFilter` wraps `inputFilter`. On exception, falls back
 * to the un-filtered history and warns to stderr once per process.
 */
let warnedFilterOnce = false;
async function safeFilter(
  filter: ((h: HandoffHistory) => HandoffHistory | Promise<HandoffHistory>) | undefined,
  history: HandoffHistory,
): Promise<HandoffHistory> {
  if (filter === undefined) return history;
  try {
    const result = filter(history);
    return result instanceof Promise ? await result : result;
  } catch (err) {
    if (!warnedFilterOnce) {
      warnedFilterOnce = true;
      process.stderr.write(
        `[handoff] inputFilter threw, falling back to full history: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    return history;
  }
}

/**
 * EC-4 / D229 — parse the LLM-provided JSON args. Returns undefined when
 * no `inputType` set; returns parsed value otherwise (default to `{}` on
 * empty/null input before Zod refinements).
 */
function parseHandoffInput(
  descriptor: HandoffDescriptor,
  raw: unknown,
): unknown {
  const inputType = descriptor.options.inputType;
  if (inputType === undefined) return undefined;
  const candidate = raw === null || raw === undefined ? {} : raw;
  return inputType.parse(candidate);
}

function isAgentDisposed(agent: SDKAgent): boolean {
  // SDKAgent doesn't expose `disposed` publicly; check via duck-typing on
  // a known internal flag. Safe fallback: if we can't tell, assume alive.
  const maybe = agent as unknown as { disposed?: boolean };
  return maybe.disposed === true;
}

/**
 * Run a single handoff hop. Returns the receiver's reply text.
 *
 * Algorithm:
 *   1. EC-5: refuse if receiver disposed.
 *   2. Build HandoffContext.
 *   3. Check isEnabled() — if false, refuse with a clear error message.
 *   4. Parse inputType (D229).
 *   5. Run onHandoff(ctx, parsed) — throw aborts (D227).
 *   6. Apply inputFilter (safeFilter — D228).
 *   7. Record hop in chain state (depth + pair guards).
 *   8. Open OTel span (D220).
 *   9. Receiver: build the user-facing message and `await receiver.send(msg).then(wait)`.
 *  10. Close span + return reply.
 */
export async function dispatchHandoff(args: {
  descriptor: HandoffDescriptor;
  senderAgentId: string;
  chainState: HandoffChainState;
  rawInputJson: unknown;
  /** The conversation so far (history wrapper). v1: just the LAST user message. */
  history: HandoffHistory;
  /** Override the message text sent to the receiver. Used by `Agent.handoffTo` imperative. */
  messageOverride?: string;
}): Promise<{ reply: string; result: HandoffResult }> {
  const { descriptor, senderAgentId, chainState, rawInputJson, history, messageOverride } = args;
  const receiver = descriptor.target;

  if (isAgentDisposed(receiver)) {
    throw new HandoffReceiverDisposedError(receiver.agentId);
  }

  const depthAfterThisHop = chainState.chain.length;
  const ctx: HandoffContext = {
    senderAgentId,
    receiverAgentId: receiver.agentId,
    currentDepth: depthAfterThisHop,
    chain: [...chainState.chain, receiver.agentId],
  };

  // isEnabled gate
  const isEnabledOpt = descriptor.options.isEnabled;
  let enabled = true;
  if (typeof isEnabledOpt === "boolean") enabled = isEnabledOpt;
  else if (typeof isEnabledOpt === "function") {
    const r = isEnabledOpt(ctx);
    enabled = r instanceof Promise ? await r : r;
  }
  if (!enabled) {
    throw new Error(`Handoff to ${receiver.agentId} is disabled (isEnabled returned false)`);
  }

  // Parse input payload (D229)
  let parsedInput: unknown;
  try {
    parsedInput = parseHandoffInput(descriptor, rawInputJson);
  } catch (err) {
    throw new Error(
      `Handoff input validation failed: ${err instanceof z.ZodError ? err.issues[0]?.message ?? "schema_invalid" : err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Run onHandoff callback (D227 — throw aborts)
  const onHandoff = descriptor.options.onHandoff;
  if (onHandoff !== undefined) {
    // biome-ignore lint/suspicious/noExplicitAny: `parsedInput` is typed unknown by design; cast at the callback boundary
    const result = onHandoff(ctx, parsedInput as any);
    if (result instanceof Promise) await result;
  }

  // Filter history (D228 — resilient)
  const filteredHistory = await safeFilter(descriptor.options.inputFilter, history);

  // Record hop — may throw HandoffLoopError or HandoffPairLoopError
  recordHop(chainState, senderAgentId, receiver.agentId);

  // Build message for receiver
  // v1 contract: pass the last user message as the new turn. Filtered history
  // is stored but not yet replayed (proper history-replay requires loop refactor;
  // deferred). Document this in the example README.
  const lastUserMessage =
    messageOverride ??
    (() => {
      const msgs = filteredHistory.messages;
      // Find last user message; fall back to a structured handoff notice.
      for (let i = msgs.length - 1; i >= 0; i -= 1) {
        const m = msgs[i] as { type?: string; message?: { role?: string; content?: unknown } };
        if (m?.type === "user" && m.message?.role === "user") {
          const content = m.message.content;
          if (typeof content === "string") return content;
          if (Array.isArray(content)) {
            const text = content
              .filter((c): c is { type: "text"; text: string } => (c as { type?: string })?.type === "text")
              .map((c) => c.text)
              .join("\n");
            if (text.length > 0) return text;
          }
        }
      }
      return `(Handoff from ${senderAgentId} — no prior user message in history.)`;
    })();

  const span = startHandoffSpan({
    from: senderAgentId,
    to: receiver.agentId,
    reason:
      typeof parsedInput === "object" && parsedInput !== null && "reason" in parsedInput
        ? String((parsedInput as { reason: unknown }).reason ?? "")
        : "",
    depth: depthAfterThisHop,
    toolName: descriptor.resolvedToolName,
  });

  try {
    const run = await receiver.send(lastUserMessage);
    const result = await run.wait();
    const reply =
      result.status === "finished" && result.result !== undefined
        ? result.result
        : `(Handoff target ${receiver.agentId} returned status=${result.status}${result.error ? `: ${result.error.message}` : ""})`;
    return {
      reply,
      result: {
        from: senderAgentId,
        to: receiver.agentId,
        depth: depthAfterThisHop,
        toolName: descriptor.resolvedToolName,
        ...(typeof parsedInput === "object" && parsedInput !== null && "reason" in parsedInput
          ? { reasonFromLlm: String((parsedInput as { reason: unknown }).reason ?? "") }
          : {}),
      },
    };
  } finally {
    span.end();
  }
}
