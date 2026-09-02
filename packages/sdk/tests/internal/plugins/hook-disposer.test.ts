/**
 * `ctx.on` returns a disposer that detaches that handler and nothing else.
 *
 * It returned `void`, which made the Observer a one-way door: a plugin registered through
 * `initialize()` had no removal path and its handlers ran for the life of the process. The one
 * documented dynamic case — the ACP permission plugin, re-installed on every prompt — worked only
 * because `#byName` keys the replacement, so re-registering the WHOLE plugin was the only way to
 * detach one hook.
 *
 * Two observers in this package already do it right: `FixtureRunBase.onDidChangeStatus` returns its
 * own unsubscribe, and `MessageBus` has an explicit `unregister`. That is what makes this a gap
 * rather than a house style.
 */
import { describe, expect, it } from "vitest";

import { createPluginContext } from "../../../src/internal/plugins/context.js";

describe("PluginContext.on — the disposer", () => {
  it("detaches the handler it was given, and leaves the others attached", () => {
    const { ctx, registrations } = createPluginContext();
    const first = () => undefined;
    const second = () => undefined;

    const offFirst = ctx.on("pre_tool_call" as never, first as never);
    ctx.on("pre_tool_call" as never, second as never);
    expect(registrations.hooks.get("pre_tool_call")).toHaveLength(2);

    offFirst();

    expect(registrations.hooks.get("pre_tool_call")).toEqual([second]);
  });

  it("detaches ONE registration when the same function was attached twice", () => {
    // Filtering by value would remove both. A disposer detaches the registration it was given.
    const { ctx, registrations } = createPluginContext();
    const handler = () => undefined;

    const offOnce = ctx.on("pre_tool_call" as never, handler as never);
    ctx.on("pre_tool_call" as never, handler as never);
    expect(registrations.hooks.get("pre_tool_call")).toHaveLength(2);

    offOnce();

    expect(registrations.hooks.get("pre_tool_call")).toHaveLength(1);
  });

  it("is idempotent — a second call does not detach a LATER registration of the same function", () => {
    // The case the `detached` guard exists for, and the one a weaker test misses: re-attaching the
    // SAME function after detaching it. Without the guard the stale disposer finds that function at
    // index 0 and removes the new registration — measured: a version of this test using a DIFFERENT
    // second handler passed with the guard deleted, because indexOf failed for an unrelated reason.
    const { ctx, registrations } = createPluginContext();
    const handler = () => undefined;

    const off = ctx.on("pre_tool_call" as never, handler as never);
    off();
    ctx.on("pre_tool_call" as never, handler as never);
    off();

    expect(
      registrations.hooks.get("pre_tool_call"),
      "the second registration is not the disposer's to remove",
    ).toEqual([handler]);
  });

  it("drops the hook key entirely when its last handler goes", () => {
    const { ctx, registrations } = createPluginContext();
    const off = ctx.on("pre_tool_call" as never, (() => undefined) as never);
    off();
    expect(registrations.hooks.has("pre_tool_call")).toBe(false);
  });

  it("returns a working disposer even for a handler it refused", () => {
    // A non-function is warned and ignored (EC-2). The caller should not have to know that in order
    // to write `const off = ctx.on(...)`.
    const { ctx, registrations } = createPluginContext();
    const off = ctx.on("pre_tool_call" as never, undefined as never);
    expect(typeof off).toBe("function");
    expect(() => off()).not.toThrow();
    expect(registrations.hooks.has("pre_tool_call")).toBe(false);
  });
});
