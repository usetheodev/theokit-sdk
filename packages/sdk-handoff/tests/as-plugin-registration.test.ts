import type { CustomTool, SDKAgent } from "@theokit/sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Handoff } from "../src/handoff.js";
import { HandoffSelfReferenceError } from "../src/types/handoff.js";

/*
 * #355 — `Handoff.asPlugin(...).register(ctx)` started an unawaited async IIFE and returned.
 *
 * Two consequences. The tools appeared at least a module-load later, so whether they existed for
 * the first `agent.send()` depended on timing no caller controls. And `normalizeHandoffs`'
 * validation errors — `HandoffSelfReferenceError`, `HandoffNameCollisionError` — became rejected
 * promises with no handler: an `unhandledRejection`, uncatchable around `Agent.create`, leaving an
 * agent that silently had no handoff tools.
 *
 * The plugin contract types `register` as `(ctx) => void | Promise<void>` and the manager awaits
 * it, so returning the promise is all this ever needed. The lazy import stays lazy: deferring it
 * until `register` runs never required leaving it unawaited INSIDE `register`.
 */

function fakeAgent(name: string): SDKAgent {
  return {
    agentId: `agent-${name}`,
    name,
    disposed: false,
    send: vi.fn(),
    close: () => undefined,
    dispose: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  } as unknown as SDKAgent;
}

function fakeContext(): { ctx: { registerTool: (t: CustomTool) => void }; tools: CustomTool[] } {
  const tools: CustomTool[] = [];
  return { ctx: { registerTool: (t) => tools.push(t) }, tools };
}

let unhandled: unknown[];
const capture = (reason: unknown): void => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled = [];
  process.on("unhandledRejection", capture);
});
afterEach(() => {
  process.off("unhandledRejection", capture);
});

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

it("has registered its tools by the time register() resolves", async () => {
  const plugin = Handoff.asPlugin({ parentAgentId: "sender", targets: [fakeAgent("billing")] });
  const { ctx, tools } = fakeContext();

  // Awaiting is what the plugin manager does. Nothing after this may still be pending.
  await (plugin as unknown as { register: (c: unknown) => void | Promise<void> }).register(ctx);

  expect(tools.map((t) => t.name)).toEqual(["transfer_to_billing"]);
});

it("surfaces a validation error to the caller instead of as an unhandled rejection", async () => {
  const self = fakeAgent("sender");
  const plugin = Handoff.asPlugin({ parentAgentId: self.agentId, targets: [self] });
  const { ctx } = fakeContext();

  await expect(
    (plugin as unknown as { register: (c: unknown) => Promise<void> }).register(ctx),
  ).rejects.toBeInstanceOf(HandoffSelfReferenceError);

  await settle();
  expect(unhandled, "the rejection must reach the caller, not the process").toEqual([]);
});

it("still short-circuits without touching the tool injector", async () => {
  // The accepted cases (`testing.md` § 4.2). A `register` that always threw, or always imported,
  // would satisfy the two tests above while breaking the documented disabled configurations.
  const { ctx, tools } = fakeContext();
  const noTargets = Handoff.asPlugin({ parentAgentId: "sender", targets: [] });
  const noDepth = Handoff.asPlugin({
    parentAgentId: "sender",
    targets: [fakeAgent("billing")],
    maxHandoffDepth: 0,
  });

  await (noTargets as unknown as { register: (c: unknown) => Promise<void> }).register(ctx);
  await (noDepth as unknown as { register: (c: unknown) => Promise<void> }).register(ctx);

  expect(tools).toEqual([]);
});
