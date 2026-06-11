/**
 * T8.1 / PV#7 — TelegramAdapter.disconnect structured-log RED test.
 *
 * Plan: arch-review-fixes-2026-06-06 § Phase 8 / T8.1
 *
 * The previous implementation silently swallowed `bot.stop()` errors with
 * `catch { /* ignore *​/ }` — violating Inquebrável Rule 8. The catch is
 * intentional (disconnect must be idempotent + safe even when the bot is
 * already torn down), but the absence of diagnostic made transient
 * `bot.stop()` failures invisible. This test asserts that the catch path
 * now emits a structured `[theokit-gateway-telegram]` stderr message
 * including the underlying error, while preserving idempotent semantics.
 */
import { describe, expect, it, vi } from "vitest";
import { TelegramAdapter } from "../src/adapter.js";

describe("TelegramAdapter.disconnect — silent-catch elimination (PV#7 / T8.1)", () => {
  it("emits structured stderr message when bot.stop() throws during disconnect", async () => {
    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      // Construct adapter with a token; we'll override the bot field directly
      // to install a controllable bot.stop mock without touching telegraf init.
      const adapter = new TelegramAdapter({
        token: "test:token",
        // biome-ignore lint/suspicious/noExplicitAny: test seam for bot mock
      } as any);

      // Force connected=true so disconnect proceeds into the try block.
      // biome-ignore lint/suspicious/noExplicitAny: test seam — accessing protected state
      (adapter as any).connected = true;
      // biome-ignore lint/suspicious/noExplicitAny: test seam — install mock bot
      (adapter as any).bot = {
        stop: vi.fn().mockRejectedValue(new Error("bot already stopped")),
      };

      // disconnect() must NOT throw (idempotent contract preserved)
      await expect(adapter.disconnect()).resolves.toBeUndefined();

      // Structured stderr emission required by Inquebrável Rule 8
      const joined = stderrWrites.join("");
      expect(joined).toContain("[theokit-gateway-telegram]");
      expect(joined).toContain("bot already stopped");
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});
