import { describe, expect, it } from "vitest";
import { AgentMailbox } from "../../src/a2a/agent-mailbox.js";
import { MessageBus } from "../../src/a2a/message-bus.js";
import type { A2AMessage } from "../../src/a2a/types.js";

describe("AgentMailbox", () => {
  it("receives messages from bus", async () => {
    const bus = new MessageBus();
    const mailbox = new AgentMailbox("agent-a", bus);
    const messages: A2AMessage[] = [];
    mailbox.onMessage((msg) => {
      messages.push(msg);
    });
    await bus.send("external", "agent-a", { type: "ping", payload: "data" });
    expect(messages.length).toEqual(1);
    expect(messages[0].payload).toEqual("data");
  });

  it("sends messages via bus", async () => {
    const bus = new MessageBus();
    const received: A2AMessage[] = [];
    bus.register("target", (msg) => {
      received.push(msg);
    });
    const mailbox = new AgentMailbox("sender", bus);
    await mailbox.send("target", { type: "hello", payload: "world" });
    expect(received.length).toEqual(1);
    expect(received[0].from).toEqual("sender");
  });

  it("dispose unregisters from bus", async () => {
    const bus = new MessageBus();
    const mailbox = new AgentMailbox("disposable", bus);
    mailbox.onMessage(() => {});
    mailbox.dispose();
    await expect(bus.send("x", "disposable", { type: "x", payload: null })).rejects.toThrow(
      "not registered",
    );
  });

  it("request/response via mailbox", async () => {
    const bus = new MessageBus();
    const responder = new AgentMailbox("responder", bus);
    responder.onMessage(async () => ({ answer: "yes" }));
    const caller = new AgentMailbox("caller", bus);
    const response = await caller.request("responder", {
      type: "question",
      payload: "do you work?",
    });
    expect(response).toEqual({ answer: "yes" });
  });
});
