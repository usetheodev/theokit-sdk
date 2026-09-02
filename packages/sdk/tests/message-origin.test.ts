import { describe, expect, it } from "vitest";
import { MessageBus } from "../src/a2a/message-bus.js";
import { Agent, Squad } from "../src/index.js";
import type { SDKAgent } from "../src/types/agent.js";
import type { MessageOrigin } from "../src/types/run.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the sessions landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

/**
 * SE3 — Multi-agent provenance (`origin`). `MessageOrigin` is stamped onto turns
 * emitted in the multi-agent path (Squad / a2a) and FORWARDED onto the run result
 * (as Anthropic forwards `origin`). Metadata-only: zero behavior change.
 *
 * TDD RED-first.
 */

const FIXTURE_KEY = "theo_test_message_origin";
const MODEL = { id: "openai/gpt-4o-mini" };

describe("MessageOrigin (SE3) — forwarded onto the run result", () => {
  it("forwards a `task-notification` origin from send() onto RunResult.origin", async () => {
    const agent = await Agent.create({ apiKey: FIXTURE_KEY, model: MODEL });
    const origin: MessageOrigin = { kind: "task-notification" };
    const run = await agent.send("hi", { origin });
    const result = await run.wait();
    expect(result.origin).toEqual({ kind: "task-notification" });
    agent.dispose();
  });

  it("forwards a `peer` origin (with `from`) onto RunResult.origin", async () => {
    const agent = await Agent.create({ apiKey: FIXTURE_KEY, model: MODEL });
    const run = await agent.send("hi", { origin: { kind: "peer", from: "agent-0" } });
    const result = await run.wait();
    expect(result.origin).toEqual({ kind: "peer", from: "agent-0" });
    agent.dispose();
  });

  it("forwards an explicit `human` origin (distinct from an absent/unstamped origin)", async () => {
    const agent = await Agent.create({ apiKey: FIXTURE_KEY, model: MODEL });
    const run = await agent.send("hi", { origin: { kind: "human" } });
    const result = await run.wait();
    // `{ kind: "human" }` is a positive host-stamped marker, NOT the same as absence.
    expect(result.origin).toEqual({ kind: "human" });
    agent.dispose();
  });

  it("leaves RunResult.origin undefined when no origin is supplied (unstamped)", async () => {
    const agent = await Agent.create({ apiKey: FIXTURE_KEY, model: MODEL });
    const run = await agent.send("hi");
    const result = await run.wait();
    expect(result.origin).toBeUndefined();
    agent.dispose();
  });
});

describe("MessageOrigin (SE3) — Squad stamps peer provenance", () => {
  interface SendCall {
    prompt: string;
    origin: MessageOrigin | undefined;
  }
  // Structural fake agent mirroring squad.test.ts's proven shape, capturing the
  // `origin` passed on each send (the workflow engine only touches agentId + send).
  function fakeAgent(tag: string, calls: SendCall[]): SDKAgent {
    return {
      agentId: `fake-${tag}`,
      async send(message: string | { text: string }, options?: { origin?: MessageOrigin }) {
        const prompt = typeof message === "string" ? message : message.text;
        calls.push({ prompt, origin: options?.origin });
        return {
          wait: async () => ({
            id: `run-${tag}`,
            status: "finished" as const,
            result: `${prompt}>${tag}`,
            usage: { inputTokens: 1, outputTokens: 1 },
          }),
        };
      },
    } as unknown as SDKAgent;
  }

  it("stamps `{ kind: 'peer', from: 'agent-<i-1>' }` on every step after the first", async () => {
    const calls: SendCall[] = [];
    const squad = Squad.create({ agents: [fakeAgent("a", calls), fakeAgent("b", calls)] });
    await squad.run("start");

    expect(calls).toHaveLength(2);
    // First agent receives the human input — no peer origin.
    expect(calls[0]?.origin).toBeUndefined();
    // Second agent receives the peer's output — stamped with peer provenance.
    expect(calls[1]?.origin).toEqual({ kind: "peer", from: "agent-0" });
  });
});

describe("MessageOrigin (SE3) — a2a projects sender provenance onto the message", () => {
  it("stamps `{ kind: 'peer', from }` as a thin projection of the a2a sender address", async () => {
    const bus = new MessageBus();
    let received: unknown;
    bus.register("worker", (msg) => {
      received = msg;
    });
    await bus.send("coordinator", "worker", { type: "task", payload: { x: 1 } });
    expect((received as { origin?: MessageOrigin }).origin).toEqual({
      kind: "peer",
      from: "coordinator",
    });
  });

  it("also projects the origin on the request()/response path", async () => {
    const bus = new MessageBus();
    let received: unknown;
    bus.register("worker", (msg) => {
      received = msg;
      return { ok: true };
    });
    await bus.request("coordinator", "worker", { type: "ask", payload: { q: 1 } });
    expect((received as { origin?: MessageOrigin }).origin).toEqual({
      kind: "peer",
      from: "coordinator",
    });
  });
});
