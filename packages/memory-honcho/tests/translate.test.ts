/**
 * Tests for translate.ts — Honcho session-key namespacing (EC-D).
 */

import { describe, expect, it } from "vitest";

import { honchoPeerKey, honchoSessionKey } from "../src/translate.js";

describe("Honcho translate (T4.1)", () => {
  it("peer key uses userId verbatim", () => {
    expect(honchoPeerKey({ userId: "alice" })).toBe("alice");
  });

  // EC-D: two users without sessionId produce DISTINCT session keys
  it("EC-D: distinct users with sessionId=undefined produce distinct session keys", () => {
    const a = honchoSessionKey({ userId: "alice" });
    const b = honchoSessionKey({ userId: "bob" });
    expect(a).toBe("alice--default");
    expect(b).toBe("bob--default");
    expect(a).not.toBe(b);
  });

  it("session falls back to default when sessionId is undefined", () => {
    expect(honchoSessionKey({ userId: "alice" })).toBe("alice--default");
  });

  it("explicit sessionId is preserved under userId namespace", () => {
    expect(honchoSessionKey({ userId: "alice", sessionId: "chat42" })).toBe("alice--chat42");
  });
});
