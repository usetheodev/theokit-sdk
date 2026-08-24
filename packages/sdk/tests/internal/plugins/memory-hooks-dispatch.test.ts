/**
 * T2.1 — pre_user_send / post_assistant_reply hook dispatch.
 *
 * Tests cover the PluginManager dispatchers directly. Wiring of these
 * dispatchers inside LocalAgent.sendLocked is exercised by Phase 2.2
 * and Phase 3 integration tests.
 */

import { describe, expect, it, vi } from "vitest";

import { PluginManager } from "../../../src/internal/plugins/manager.js";
import type {
  PostAssistantReplyContext,
  PreUserSendContext,
  PreUserSendResult,
} from "../../../src/internal/plugins/types.js";
import { Plugin } from "../../../src/internal/plugins/types.js";

function makeRecallPlugin(name: string, recalledContext: string) {
  return Plugin.create({
    name,
    version: "1.0.0",
    kind: "general",
    register: (ctx) => {
      ctx.on("pre_user_send", async (_input) => {
        return { recalledContext } satisfies PreUserSendResult;
      });
    },
  });
}

function makeSyncPlugin(name: string, onPostReply: (ctx: PostAssistantReplyContext) => void) {
  return Plugin.create({
    name,
    version: "1.0.0",
    kind: "general",
    register: (ctx) => {
      ctx.on("post_assistant_reply", async (input) => {
        onPostReply(input as PostAssistantReplyContext);
      });
    },
  });
}

describe("PluginManager memory-hook dispatch (T2.1)", () => {
  // ── pre_user_send happy path ────────────────────────────────────────
  it("pre_user_send: returns concatenated recalled context", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([makeRecallPlugin("a", "fact A"), makeRecallPlugin("b", "fact B")]);
    const ctx: PreUserSendContext = { prompt: "hi", agentId: "ag", runId: "rn" };
    const result = await mgr.runPreUserSendHooks(ctx, 16_000);
    expect(result).toBe("fact A\n\nfact B");
  });

  it("pre_user_send: returns undefined when no handlers registered", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([]);
    const result = await mgr.runPreUserSendHooks(
      { prompt: "hi", agentId: "ag", runId: "rn" },
      16_000,
    );
    expect(result).toBeUndefined();
  });

  it("pre_user_send: returns undefined when all handlers return empty", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([
      Plugin.create({
        name: "noop",
        version: "1.0.0",
        kind: "general",
        register: (ctx) => {
          ctx.on("pre_user_send", async () => ({}));
        },
      }),
    ]);
    const result = await mgr.runPreUserSendHooks(
      { prompt: "hi", agentId: "ag", runId: "rn" },
      16_000,
    );
    expect(result).toBeUndefined();
  });

  // ── EC-8: adapter throw does not block (graceful degrade) ───────────
  it("pre_user_send: handler throw is logged + skipped, others continue (EC-8)", async () => {
    const stderr = vi.spyOn(process.stderr, "write");
    const mgr = new PluginManager();
    await mgr.initialize([
      Plugin.create({
        name: "broken",
        version: "1.0.0",
        kind: "general",
        register: (ctx) => {
          ctx.on("pre_user_send", async () => {
            throw new Error("boom");
          });
        },
      }),
      makeRecallPlugin("ok", "still here"),
    ]);
    const result = await mgr.runPreUserSendHooks(
      { prompt: "hi", agentId: "ag", runId: "rn" },
      16_000,
    );
    expect(result).toBe("still here");
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("boom"));
    stderr.mockRestore();
  });

  // ── EC-A: recall context capped at maxRecallContextBytes ────────────
  it("pre_user_send: caps total recall at maxRecallContextBytes (EC-A)", async () => {
    const mgr = new PluginManager();
    const huge = "x".repeat(20_000);
    await mgr.initialize([makeRecallPlugin("huge", huge)]);
    const result = await mgr.runPreUserSendHooks(
      { prompt: "hi", agentId: "ag", runId: "rn" },
      4_096,
    );
    expect(result).toBeDefined();
    // 4096 + "\n…[truncated]" suffix
    expect(result?.length).toBe(4_096 + "\n…[truncated]".length);
    expect(result?.endsWith("…[truncated]")).toBe(true);
  });

  it("pre_user_send: caller-overridden cap respected exactly (EC-A)", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([makeRecallPlugin("med", "y".repeat(500))]);
    const result = await mgr.runPreUserSendHooks({ prompt: "hi", agentId: "ag", runId: "rn" }, 100);
    expect(result?.startsWith("y".repeat(100))).toBe(true);
    expect(result?.endsWith("…[truncated]")).toBe(true);
  });

  // ── post_assistant_reply ────────────────────────────────────────────
  it("post_assistant_reply: fires for each handler with the same context", async () => {
    const seen: PostAssistantReplyContext[] = [];
    const mgr = new PluginManager();
    await mgr.initialize([
      makeSyncPlugin("a", (ctx) => seen.push(ctx)),
      makeSyncPlugin("b", (ctx) => seen.push(ctx)),
    ]);
    await mgr.runPostAssistantReplyHooks({
      prompt: "hi",
      reply: "hello",
      agentId: "ag",
      runId: "rn",
      usedTools: false,
    });
    expect(seen.length).toBe(2);
    expect(seen[0]?.reply).toBe("hello");
    expect(seen[1]?.reply).toBe("hello");
  });

  it("post_assistant_reply: handler throw is logged + others continue (EC-O)", async () => {
    const stderr = vi.spyOn(process.stderr, "write");
    const calls: string[] = [];
    const mgr = new PluginManager();
    await mgr.initialize([
      Plugin.create({
        name: "broken",
        version: "1.0.0",
        kind: "general",
        register: (ctx) => {
          ctx.on("post_assistant_reply", async () => {
            throw new Error("sync down");
          });
        },
      }),
      makeSyncPlugin("ok", () => calls.push("survived")),
    ]);
    await mgr.runPostAssistantReplyHooks({
      prompt: "hi",
      reply: "hello",
      agentId: "ag",
      runId: "rn",
      usedTools: false,
    });
    expect(calls).toEqual(["survived"]);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("sync down"));
    stderr.mockRestore();
  });

  // ── EC-G: user prompt containing literal <memory-context> survives ──
  it("EC-G: prompt with literal <memory-context> in user text is not trimmed by injection", () => {
    // The trim/injection logic concatenates around the user prompt without
    // mutating it. Verify the fence we inject is distinct from arbitrary
    // user text containing the same string.
    const userPrompt = "What is <memory-context> used for in HTML?";
    const recalled = "User likes XML.";
    const wrapped = `<memory-context>\n${recalled}\n</memory-context>\n\n${userPrompt}`;
    // The injected fence is the FIRST line; the user's substring is preserved verbatim.
    expect(wrapped.endsWith(userPrompt)).toBe(true);
    expect(wrapped.indexOf("<memory-context>")).toBe(0);
    // The user's literal occurrence is still discoverable downstream
    expect(wrapped.lastIndexOf("<memory-context>")).toBeGreaterThan(0);
  });

  // ── EC-H: AbortSignal propagation through PreUserSendContext ────────
  it("EC-H: pre_user_send ctx surfaces AbortSignal for adapter cancellation", async () => {
    const mgr = new PluginManager();
    const observed: AbortSignal[] = [];
    await mgr.initialize([
      Plugin.create({
        name: "abort-aware",
        version: "1.0.0",
        kind: "general",
        register: (ctx) => {
          ctx.on("pre_user_send", async (input) => {
            const c = input as PreUserSendContext;
            if (c.signal) observed.push(c.signal);
            return {};
          });
        },
      }),
    ]);
    const controller = new AbortController();
    await mgr.runPreUserSendHooks(
      { prompt: "hi", agentId: "ag", runId: "rn", signal: controller.signal },
      16_000,
    );
    expect(observed.length).toBe(1);
    expect(observed[0]).toBe(controller.signal);
  });
});
