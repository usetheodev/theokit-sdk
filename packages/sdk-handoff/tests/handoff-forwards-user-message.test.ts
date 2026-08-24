import type { CustomTool, SDKAgent } from "@theokit/sdk";
import { expect, it, vi } from "vitest";
import { Handoff } from "../src/handoff.js";
import { buildHandoffTool, normalizeHandoffs } from "../src/internal/tool-injector.js";

/*
 * #354 — the receiving agent was told nothing about the conversation.
 *
 * Both wirings (`Handoff.asPlugin` and the legacy `Agent.create({ handoffs })`) built the transfer
 * tool through `buildHandoffTool`, whose handler dispatched with `history: { messages: [] }`. The
 * dispatcher then found no user message and sent the receiver the literal placeholder
 * `(Handoff from <sender> — no prior user message in history.)`, so whatever the user actually
 * asked was never forwarded and the receiver answered from that sentence plus its system prompt.
 *
 * `HandoffOptions.inputFilter` — documented as the redaction hook — was dead in the same way: it
 * was invoked, always with `{ messages: [] }`, so a caller who wired a redactor believed the
 * transcript was being scrubbed while nothing was passed at all.
 *
 * The SDK already hands a tool handler the supervisor transcript as `ctx.messages`; the subagent
 * path consumes exactly that.
 */

function fakeReceiver(): { agent: SDKAgent; sent: string[] } {
  const sent: string[] = [];
  const agent = {
    agentId: "agent-billing",
    name: "billing",
    disposed: false,
    send: vi.fn(async (msg: string) => {
      sent.push(msg);
      return { wait: async () => ({ id: "r1", status: "finished" as const, result: "ok" }) };
    }),
    close: () => undefined,
    dispose: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  } as unknown as SDKAgent;
  return { agent, sent };
}

function transferTool(
  receiver: SDKAgent,
  options?: Parameters<typeof Handoff.create>[1],
): CustomTool {
  const descriptor = Handoff.create(receiver, options);
  const [normalized] = normalizeHandoffs("sender", [descriptor]);
  if (normalized === undefined) throw new Error("no descriptor");
  return buildHandoffTool("sender", normalized.descriptor, 5);
}

it("forwards the user's last message to the receiving agent", async () => {
  const { agent, sent } = fakeReceiver();
  const tool = transferTool(agent);

  await tool.handler(
    { reason: "billing question" },
    { messages: [{ role: "user", content: "What is my balance?" }] },
  );

  expect(sent).toEqual(["What is my balance?"]);
});

it("reads the LAST user message, not the first, and ignores assistant turns", async () => {
  const { agent, sent } = fakeReceiver();
  const tool = transferTool(agent);

  await tool.handler(
    { reason: "r" },
    {
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello! How can I help?" },
        { role: "user", content: "Cancel my subscription." },
      ],
    },
  );

  expect(sent).toEqual(["Cancel my subscription."]);
});

it("gives inputFilter the real transcript, so a redactor can actually redact", async () => {
  const { agent, sent } = fakeReceiver();
  const seen: unknown[] = [];
  const tool = transferTool(agent, {
    inputFilter: (history) => {
      seen.push(...history.messages);
      return { messages: history.messages.filter((m) => !JSON.stringify(m).includes("4111")) };
    },
  });

  await tool.handler(
    { reason: "r" },
    {
      messages: [
        { role: "user", content: "my card is 4111 1111 1111 1111" },
        { role: "user", content: "when does my plan renew?" },
      ],
    },
  );

  expect(seen).toHaveLength(2);
  expect(sent).toEqual(["when does my plan renew?"]);
});

it("still falls back to the placeholder when there is genuinely no user message", async () => {
  // The accepted case (`testing.md` § 4.2). The placeholder is correct when a transfer happens
  // with no prior user turn — a tool called from a system-initiated run, say. What was wrong is
  // that it was the ONLY outcome.
  const { agent, sent } = fakeReceiver();
  const tool = transferTool(agent);

  await tool.handler({ reason: "r" }, { messages: [] });

  expect(sent[0]).toMatch(/no prior user message in history/);
});
