import type { SDKAgent } from "@theokit/sdk";
import { expect, it, vi } from "vitest";
import { Handoff } from "../src/handoff.js";
import { dispatchHandoff } from "../src/internal/dispatcher.js";
import { createChainState } from "../src/internal/registry.js";

/*
 * #356 — `HandoffOptions.tools` was public API that nothing read.
 *
 * It was presented as an allowlist ("whitelist / etc" on `Handoff.create`), so a caller passing
 * `{ tools: ["read_file"] }` believed the receiving agent lost its other tools. They got no
 * restriction and no warning: a security-shaped no-op, which is worse than an absent option
 * because it gives false assurance.
 *
 * The SDK already restricts a send's tool set — `SendOptions.activeTools`, the same
 * `withToolWhitelist` path `Agent.fork`'s `allowedTools` uses — so this is a wiring, not a feature.
 */

function fakeReceiver(): { agent: SDKAgent; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => ({
    wait: async () => ({ id: "r1", status: "finished" as const, result: "ok" }),
  }));
  const agent = {
    agentId: "agent-billing",
    name: "billing",
    disposed: false,
    send,
    close: () => undefined,
    dispose: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  } as unknown as SDKAgent;
  return { agent, send };
}

async function dispatch(options: Parameters<typeof Handoff.create>[1]) {
  const { agent, send } = fakeReceiver();
  await dispatchHandoff({
    descriptor: Handoff.create(agent, options),
    senderAgentId: "sender",
    chainState: createChainState("sender", 5),
    rawInputJson: { reason: "r" },
    history: { messages: [] },
    messageOverride: "do the thing",
  });
  return send;
}

it("restricts the receiver to the declared tools", async () => {
  const send = await dispatch({ tools: ["read_file"] });

  expect(send).toHaveBeenCalledWith(
    "do the thing",
    expect.objectContaining({
      activeTools: ["read_file"],
    }),
  );
});

it("treats an empty list as the empty set, not as no restriction", async () => {
  // Fail-closed, matching `SendOptions.activeTools`: "restrict to the empty set" is a coherent
  // thing to ask for, and silently reading it as "no restriction" would invert a security option.
  const send = await dispatch({ tools: [] });

  expect(send).toHaveBeenCalledWith("do the thing", expect.objectContaining({ activeTools: [] }));
});

it("imposes no restriction when the option is omitted", async () => {
  // The accepted case (`testing.md` § 4.2). A wiring that always passed a whitelist would satisfy
  // both tests above while silently narrowing every handoff that never asked for one.
  const send = await dispatch(undefined);

  const [, opts] = send.mock.calls[0] ?? [];
  expect((opts as { activeTools?: unknown } | undefined)?.activeTools).toBeUndefined();
});
