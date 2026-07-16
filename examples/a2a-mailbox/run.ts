/**
 * A2A — agents address and message each other through a MessageBus. Deterministic (no LLM):
 * in-process fire-and-forget (send) and request/response (request).
 */
import { AgentMailbox, MessageBus } from "@theokit/sdk/a2a";

const bus = new MessageBus();

// Worker: replies to "translate" requests.
const worker = new AgentMailbox("worker", bus);
worker.onMessage((msg) => {
  if (msg.type === "translate") return `[fr] ${String(msg.payload)}`;
});

// Supervisor: fire-and-forget, then request a reply.
const supervisor = new AgentMailbox("supervisor", bus);
await supervisor.send("worker", { type: "note", payload: "starting" });
const reply = await supervisor.request("worker", { type: "translate", payload: "good morning" });

console.log("reply:", reply);

worker.dispose();
supervisor.dispose();
