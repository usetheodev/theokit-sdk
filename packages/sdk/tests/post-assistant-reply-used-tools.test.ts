import { expect, it, vi } from "vitest";
import { wrapRunWithPostReplyHook } from "../src/internal/local-agent/local-agent-memory-hooks.js";
import type { PostAssistantReplyContext } from "../src/types/plugin.js";
import type { Run } from "../src/types/run.js";

/*
 * #358 — `PostAssistantReplyContext` carried no tool signal, so every consumer had to guess.
 *
 * `@theokit/sdk-cache` keys its D266/EC-10 guard on `usedTools` — replaying an answer produced by a
 * `write_file` / HTTP POST / payment call re-serves the text without the side effect. In plugin
 * mode it had nothing to read and hardcoded `false`, so the guard never fired on the only path
 * that runs automatically.
 *
 * The run already knows. `stream()` replays the buffered events after `wait()` (ADR 0006), and a
 * `tool_call` among them is exactly the signal. It is computed inside the existing fire-and-forget
 * path, which runs only when a hook is registered, so nothing lands on the caller's critical path.
 */

function fakeRun(events: ReadonlyArray<Record<string, unknown>>): Run {
  return {
    wait: async () => ({ id: "run-1", status: "finished" as const, result: "the answer" }),
    stream: async function* () {
      for (const e of events) yield e;
    },
  } as unknown as Run;
}

async function captureContext(
  events: ReadonlyArray<Record<string, unknown>>,
): Promise<PostAssistantReplyContext> {
  const seen: PostAssistantReplyContext[] = [];
  const pluginManager = {
    hooksFor: () => [vi.fn()],
    runPostAssistantReplyHooks: async (ctx: PostAssistantReplyContext) => {
      seen.push(ctx);
    },
  };
  const run = wrapRunWithPostReplyHook({
    pluginManager: pluginManager as never,
    agentId: "agent-1",
    options: {} as never,
    run: fakeRun(events),
    userText: "do the thing",
  });
  await run.wait();
  await new Promise((r) => setTimeout(r, 10)); // the hook is fire-and-forget
  const ctx = seen[0];
  if (ctx === undefined) throw new Error("hook never fired");
  return ctx;
}

it("reports usedTools when the run called a tool", async () => {
  const ctx = await captureContext([
    { type: "text" },
    { type: "tool_call", name: "write_file", status: "completed" },
  ]);

  expect(ctx.usedTools).toBe(true);
});

it("reports usedTools false for a plain text answer", async () => {
  // The accepted case (`testing.md` § 4.2). A signal hardcoded to `true` would satisfy the test
  // above while disabling the cache entirely — the mirror image of the bug being fixed.
  const ctx = await captureContext([{ type: "text" }, { type: "text" }]);

  expect(ctx.usedTools).toBe(false);
});

it("still delivers the prompt, reply and run id", async () => {
  const ctx = await captureContext([{ type: "tool_call", name: "x" }]);

  expect(ctx.prompt).toBe("do the thing");
  expect(ctx.reply).toBe("the answer");
  expect(ctx.runId).toBe("run-1");
});
