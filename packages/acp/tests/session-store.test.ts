/**
 * T2.1 — SessionStore tests.
 */

import { describe, expect, it } from "vitest";
import { type AcpSession, SessionStore } from "../src/session-store.js";

const fakeAgent = { agentId: "a-1", model: undefined } as unknown as AcpSession["agent"];

function makeSession(sessionId: string): AcpSession {
  return {
    sessionId,
    agent: fakeAgent,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    abortController: new AbortController(),
    cwd: "/tmp",
  };
}

describe("SessionStore", () => {
  it("session_store_create_returns_session", () => {
    const store = new SessionStore();
    const s = makeSession("s-1");
    store.create(s);
    expect(store.get("s-1")).toBe(s);
    expect(store.size()).toBe(1);
  });

  it("session_store_delete_removes_session", () => {
    const store = new SessionStore();
    store.create(makeSession("s-1"));
    expect(store.delete("s-1")).toBe(true);
    expect(store.get("s-1")).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it("session_store_duplicate_create_throws", () => {
    const store = new SessionStore();
    store.create(makeSession("s-1"));
    expect(() => store.create(makeSession("s-1"))).toThrow(/duplicate sessionId/);
  });

  it("list returns snapshot", () => {
    const store = new SessionStore();
    store.create(makeSession("a"));
    store.create(makeSession("b"));
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.sessionId).sort()).toEqual(["a", "b"]);
  });
});
