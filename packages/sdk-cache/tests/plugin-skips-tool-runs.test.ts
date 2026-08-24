import type { PluginContext, PostAssistantReplyContext } from "@theokit/sdk";
import { expect, it } from "vitest";
import { Cache } from "../src/cache.js";

/*
 * #358 — the plugin cached tool-using turns, defeating its own D266/EC-10 guard.
 *
 * `store-handler.ts` skips storage when `usedTools` is true, because replaying such an answer
 * hands a later caller the RESULT of a `write_file` / HTTP POST / payment without the side effect
 * having happened. The `post_assistant_reply` hook passed the literal `false`, so the guard never
 * fired for plugin-mode users — the only path that runs automatically. Only a hand-written
 * `cache.remember(..., { usedTools: true })` reached it.
 *
 * The comment above that literal described a heuristic ("accept the conservative-skip if `c.reply`
 * looks like a tool result envelope") that was never implemented, so it read as a mitigation over
 * code that had none.
 */

function fakeCache(): { cache: Cache; stored: string[] } {
  const stored: string[] = [];
  const cache = Cache.semantic({
    embedder: {
      id: "fake",
      model: "fake-1",
      dimension: 4,
      embed: async (texts: ReadonlyArray<string>) => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
    },
  });
  // The in-memory store the factory built; the assertion is about what reaches its `set`.
  const store = (cache as unknown as { store: { set: (e: { prompt: string }) => void } }).store;
  const realSet = store.set.bind(store);
  store.set = (entry: { prompt: string }) => {
    stored.push(entry.prompt);
    realSet(entry);
  };
  return { cache, stored };
}

/** Drive the plugin's `post_assistant_reply` hook the way the runtime does. */
async function reply(cache: Cache, ctx: Partial<PostAssistantReplyContext>): Promise<void> {
  const handlers: Array<(c: unknown) => unknown> = [];
  const pluginCtx = {
    on: (_event: string, handler: (c: unknown) => unknown) => handlers.push(handler),
    registerTool: () => undefined,
    registerCommand: () => undefined,
  } as unknown as PluginContext;

  const plugin = cache.asPlugin() as unknown as { register: (c: PluginContext) => unknown };
  await plugin.register(pluginCtx);
  for (const handler of handlers) {
    await handler({
      prompt: "p",
      reply: "r",
      agentId: "a",
      runId: "run-1",
      usedTools: false,
      ...ctx,
    });
  }
}

it("does not cache a reply the run produced with tools", async () => {
  const { cache, stored } = fakeCache();

  await reply(cache, { prompt: "delete the old invoices", usedTools: true });

  expect(stored).toEqual([]);
});

it("still caches a plain text reply", async () => {
  // The accepted case (`testing.md` § 4.2). A hook that skipped everything would satisfy the test
  // above while making the cache store nothing at all.
  const { cache, stored } = fakeCache();

  await reply(cache, { prompt: "what is our refund window?", usedTools: false });

  expect(stored).toEqual(["what is our refund window?"]);
});
