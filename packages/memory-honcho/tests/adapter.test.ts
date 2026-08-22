/**
 * HonchoAdapter — vi.mock-driven unit tests.
 */

import { MemoryAdapterError, mkMemoryId } from "@theokit/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HonchoAdapter } from "../src/adapter.js";
import { honchoMemory } from "../src/index.js";

const honchoState = vi.hoisted(() => ({
  peerCalls: [] as string[],
  sessionCalls: [] as string[],
  addPeersCalls: [] as unknown[],
  addMessagesCalls: [] as unknown[],
  chatCalls: [] as Array<{ query: string; sessionKey: string }>,
  chatReply: "synthesized answer about user" as string | null,
  addMessageId: "msg-default" as string,
  nextError: undefined as { name?: string; status?: number; message?: string } | undefined,
}));

vi.mock("@honcho-ai/sdk", () => {
  class FakePeer {
    constructor(public id: string) {}
    message(text: string) {
      return { peer: this.id, text };
    }
    async chat(query: string, options?: { session?: FakeSession }) {
      if (honchoState.nextError) {
        const e = honchoState.nextError;
        honchoState.nextError = undefined;
        const err = new Error(e.message ?? "mock") as Error & { status?: number };
        if (e.status !== undefined) err.status = e.status;
        if (e.name !== undefined) err.name = e.name;
        throw err;
      }
      honchoState.chatCalls.push({ query, sessionKey: options?.session?.id ?? "" });
      return honchoState.chatReply;
    }
  }
  class FakeSession {
    constructor(public id: string) {}
    async addPeers(peers: unknown) {
      if (honchoState.nextError) {
        const e = honchoState.nextError;
        honchoState.nextError = undefined;
        const err = new Error(e.message ?? "mock") as Error & { status?: number };
        if (e.status !== undefined) err.status = e.status;
        if (e.name !== undefined) err.name = e.name;
        throw err;
      }
      honchoState.addPeersCalls.push(peers);
    }
    async addMessages(messages: unknown) {
      if (honchoState.nextError) {
        const e = honchoState.nextError;
        honchoState.nextError = undefined;
        const err = new Error(e.message ?? "mock") as Error & { status?: number };
        if (e.status !== undefined) err.status = e.status;
        if (e.name !== undefined) err.name = e.name;
        throw err;
      }
      honchoState.addMessagesCalls.push(messages);
      return [{ id: honchoState.addMessageId }];
    }
  }
  class FakeHoncho {
    // biome-ignore lint/complexity/noUselessConstructor: signature-matching constructor for vi.mock factory — opts arg required to mirror real Honcho class.
    constructor(_opts: unknown) {}
    async peer(id: string) {
      honchoState.peerCalls.push(id);
      return new FakePeer(id);
    }
    async session(id: string) {
      honchoState.sessionCalls.push(id);
      return new FakeSession(id);
    }
  }
  return { Honcho: FakeHoncho };
});

beforeEach(() => {
  honchoState.peerCalls = [];
  honchoState.sessionCalls = [];
  honchoState.addPeersCalls = [];
  honchoState.addMessagesCalls = [];
  honchoState.chatCalls = [];
  honchoState.chatReply = "synthesized answer about user";
  honchoState.addMessageId = "msg-default";
  honchoState.nextError = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("HonchoAdapter (T4.1)", () => {
  it("write creates peer + session and adds message", async () => {
    honchoState.addMessageId = "msg-99";
    const adapter = new HonchoAdapter({ apiKey: "sk-test" });
    const id = await adapter.write("hi", { userId: "alice" });
    expect(id).toBe("honcho:msg-99");
    expect(honchoState.peerCalls).toContain("alice");
    expect(honchoState.sessionCalls).toContain("alice--default");
    expect(honchoState.addPeersCalls.length).toBe(1);
    expect(honchoState.addMessagesCalls.length).toBe(1);
  });

  it("recall wraps chat response as a single fact with score=1.0", async () => {
    honchoState.chatReply = "User likes jazz";
    const adapter = new HonchoAdapter({ apiKey: "sk-test" });
    const facts = await adapter.recall("music?", { userId: "alice" });
    expect(facts.length).toBe(1);
    expect(facts[0]?.content).toBe("User likes jazz");
    expect(facts[0]?.score).toBe(1.0);
  });

  it("recall returns empty array when chat returns empty string", async () => {
    honchoState.chatReply = "";
    const adapter = new HonchoAdapter({ apiKey: "sk-test" });
    expect(await adapter.recall("q", { userId: "alice" })).toEqual([]);
  });

  it("recall returns empty array when chat returns null", async () => {
    honchoState.chatReply = null;
    const adapter = new HonchoAdapter({ apiKey: "sk-test" });
    expect(await adapter.recall("q", { userId: "alice" })).toEqual([]);
  });

  it("capabilities declares sessions=true + reasoning=true + history=false", () => {
    const adapter = new HonchoAdapter({ apiKey: "sk-test" });
    expect(adapter.capabilities.sessions).toBe(true);
    expect(adapter.capabilities.reasoning).toBe(true);
    expect(adapter.capabilities.history).toBe(false);
  });

  it("translate.peer uses userId verbatim", async () => {
    const adapter = new HonchoAdapter({ apiKey: "sk-test" });
    await adapter.write("hi", { userId: "bob" });
    expect(honchoState.peerCalls[0]).toBe("bob");
  });

  // EC-D: distinct users get distinct sessions
  it("EC-D: two users with sessionId=undefined produce distinct session keys", async () => {
    const adapter = new HonchoAdapter({ apiKey: "sk-test" });
    await adapter.write("a-msg", { userId: "alice" });
    await adapter.write("b-msg", { userId: "bob" });
    expect(honchoState.sessionCalls).toContain("alice--default");
    expect(honchoState.sessionCalls).toContain("bob--default");
  });

  it("translate.session falls back to default", async () => {
    const adapter = new HonchoAdapter({ apiKey: "sk-test" });
    await adapter.write("hi", { userId: "alice" });
    expect(honchoState.sessionCalls).toContain("alice--default");
  });

  // EC-J: tool schema description mentions "reasoning" / "synthesized answer"
  it("EC-J: memory_recall tool description references reasoning, not raw facts", () => {
    const adapter = new HonchoAdapter({ apiKey: "sk-test" });
    const schemas = adapter.getToolSchemas();
    const recall = schemas.find((s) => s.name === "memory_recall");
    expect(recall).toBeDefined();
    expect(recall?.description.toLowerCase()).toMatch(/reasoning|synthesized/);
    expect(recall?.description.toLowerCase()).not.toMatch(/list of raw facts$/);
  });

  // EC-B: cross-adapter MemoryId rejected
  it("EC-B: delete rejects MemoryId minted by a different adapter", async () => {
    const adapter = new HonchoAdapter({ apiKey: "sk-test" });
    const supermemoryId = mkMemoryId("supermemory", "x");
    await expect(adapter.delete(supermemoryId)).rejects.toThrow(MemoryAdapterError);
  });

  it("auth error maps to auth_failed", async () => {
    honchoState.nextError = { name: "AuthenticationError", message: "bad key" };
    const adapter = new HonchoAdapter({ apiKey: "bad" });
    await expect(adapter.write("hi", { userId: "alice" })).rejects.toMatchObject({
      code: "auth_failed",
      adapterId: "honcho",
    });
  });

  it("factory returns a valid Plugin", () => {
    const plugin = honchoMemory({ apiKey: "sk-test" });
    expect(plugin.kind).toBe("memory");
    expect(plugin.name).toBe("@theokit/memory-honcho");
  });

  // EC-CI: README disclosure presence — grep-style lint
  it("README contains AGPL self-host disclosure section", async () => {
    const { readFile } = await import("node:fs/promises");
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).toMatch(/## License & Self-Hosting/);
    expect(readme).toMatch(/AGPL-3\.0/);
  });
});
