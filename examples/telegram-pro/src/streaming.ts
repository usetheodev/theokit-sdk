import type { SDKAgent } from "@usetheo/sdk";
import type { Context } from "grammy";

import { splitForTelegram } from "./format.js";

/**
 * Incremental streaming primitive for Telegram (ADR D52, D58).
 *
 * Sends 1 placeholder message, then iterates `run.stream()` accumulating
 * text deltas in a buffer. Edits the same message at most every 500ms
 * (throttle to stay under Telegram rate limits). On stream end, performs
 * a final edit with the complete text. If the buffer exceeds Telegram's
 * 4096-char limit, deletes the incremental message and falls back to
 * `splitForTelegram` + multi-reply.
 *
 * Edge cases handled (from edge-case-plan review):
 *   - EC-1: initial ctx.reply may fail (502/network) → guarded with try/catch
 *   - EC-2: editMessageText may fail "message to edit not found" → broader regex catch
 *   - EC-3: setTimeout leak in error path → cleanup in finally
 *   - EC-4: zero deltas (Gemini batched) → fallback to run.wait() result
 *
 * @internal to the telegram-pro example
 */

const EDIT_THROTTLE_MS = 500;
const TELEGRAM_MAX_MSG_CHARS = 4000; // safety margin under 4096 hard limit

/** Stream mode toggle (ADR D53). Module-scoped, env-default at module load. */
let currentMode: "wait" | "stream" = process.env.STREAM_MODE === "stream" ? "stream" : "wait";

export function getStreamMode(): "wait" | "stream" {
  return currentMode;
}

export function setStreamMode(mode: "wait" | "stream"): void {
  currentMode = mode;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: streaming primitive must handle placeholder lifecycle + throttle + EC-1/EC-2/EC-3/EC-4 fallbacks inline; refactoring fragments the invariants.
export async function streamIntoTelegram(
  ctx: Context,
  agent: SDKAgent,
  prompt: string,
  sendOptions: Parameters<SDKAgent["send"]>[1] = {},
): Promise<void> {
  // EC-1: ctx.reply may fail (502/network). Guard initial message.
  let placeholder: Awaited<ReturnType<typeof ctx.reply>> | undefined;
  try {
    placeholder = await ctx.reply("...");
  } catch (err) {
    console.error("[streamIntoTelegram] initial reply failed:", err);
    return;
  }
  if (placeholder?.message_id === undefined) {
    console.error("[streamIntoTelegram] placeholder reply returned without message_id");
    return;
  }
  const msgId = placeholder.message_id;
  const chatId = placeholder.chat.id;

  let buffer = "";
  let lastEditAt = 0;
  let pendingEdit: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const flushEdit = async () => {
    if (cancelled) return;
    const text =
      buffer.length > TELEGRAM_MAX_MSG_CHARS
        ? `${buffer.slice(0, TELEGRAM_MAX_MSG_CHARS)}\n...`
        : buffer;
    if (text.length === 0) return;
    try {
      await ctx.api.editMessageText(chatId, msgId, text);
    } catch (err) {
      // EC-2: broader catch — "not modified" (benign), "message to edit not
      // found" / "message can't be edited" (user deleted or permissions
      // changed). All terminate stream gracefully.
      if (
        err instanceof Error &&
        /not modified|message to edit not found|message can't be edited/i.test(err.message)
      ) {
        cancelled = true;
        return;
      }
      throw err;
    }
    lastEditAt = Date.now();
  };

  const scheduleEdit = () => {
    if (pendingEdit !== undefined) return;
    const elapsed = Date.now() - lastEditAt;
    const wait = Math.max(0, EDIT_THROTTLE_MS - elapsed);
    pendingEdit = setTimeout(() => {
      pendingEdit = undefined;
      void flushEdit();
    }, wait);
  };

  const run = await agent.send(prompt, sendOptions);
  try {
    for await (const evt of run.stream()) {
      if (evt.type === "assistant") {
        for (const part of evt.message.content) {
          if (part.type === "text" && part.text.length > 0) {
            buffer += part.text;
            scheduleEdit();
          }
        }
      }
    }
    await flushEdit(); // ensure final state

    // EC-4: zero deltas (Gemini batched) → buffer empty → placeholder stays "..."
    // Fallback: read the final result via run.wait() and replace the placeholder.
    if (buffer.length === 0) {
      try {
        const result = await run.wait();
        const fallback = result.result ?? `(${result.status})`;
        await ctx.api.editMessageText(
          chatId,
          msgId,
          fallback.slice(0, TELEGRAM_MAX_MSG_CHARS),
        );
      } catch {
        // best-effort fallback; do not crash the bot
      }
      return;
    }

    // After stream finalize: if buffer exceeds Telegram limit, switch to split.
    if (buffer.length > TELEGRAM_MAX_MSG_CHARS) {
      cancelled = true;
      try {
        await ctx.api.deleteMessage(chatId, msgId);
      } catch {
        // best-effort delete; ignore "message can't be deleted" etc.
      }
      for (const part of splitForTelegram(buffer)) {
        await ctx.reply(part);
      }
    }
  } catch (cause) {
    cancelled = true;
    const msg = cause instanceof Error ? cause.message : String(cause);
    try {
      await ctx.api.editMessageText(chatId, msgId, `❌ Stream error: ${msg.slice(0, 200)}`);
    } catch {
      // best-effort error display
    }
    throw cause;
  } finally {
    // EC-3: cancel pending timer in BOTH happy and error paths.
    if (pendingEdit !== undefined) clearTimeout(pendingEdit);
  }
}
