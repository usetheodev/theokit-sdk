/**
 * Tests for group-policy.ts (T5.1).
 */

import { describe, expect, it } from "vitest";

import { type PolicyContext, shouldRespondInChat, stripBotMention } from "../src/group-policy.js";

type FakeContext = {
  chat?: { type: "private" | "group" | "supergroup"; id: number };
  message?: {
    text?: string;
    caption?: string;
    reply_to_message?: { from?: { id: number } };
  };
};

const policy: PolicyContext = { botUsername: "theo_paulo_bot", botId: 4242 };

describe("shouldRespondInChat (T5.1)", () => {
  it("DM always responds", () => {
    const ctx = {
      chat: { type: "private", id: 1 } as const,
      message: { text: "anything" },
    };
    expect(shouldRespondInChat(ctx as never, policy)).toBe(true);
  });

  it("group: slash command always responds", () => {
    const ctx: FakeContext = {
      chat: { type: "group", id: 1 },
      message: { text: "/help" },
    };
    expect(shouldRespondInChat(ctx as never, policy)).toBe(true);
  });

  it("group: @-mention responds", () => {
    const ctx: FakeContext = {
      chat: { type: "group", id: 1 },
      message: { text: "@theo_paulo_bot hi" },
    };
    expect(shouldRespondInChat(ctx as never, policy)).toBe(true);
  });

  it("group: reply to bot responds", () => {
    const ctx: FakeContext = {
      chat: { type: "group", id: 1 },
      message: { text: "thanks", reply_to_message: { from: { id: 4242 } } },
    };
    expect(shouldRespondInChat(ctx as never, policy)).toBe(true);
  });

  it("group: random message ignored", () => {
    const ctx: FakeContext = {
      chat: { type: "group", id: 1 },
      message: { text: "random chatter" },
    };
    expect(shouldRespondInChat(ctx as never, policy)).toBe(false);
  });

  it("undefined chat → false", () => {
    expect(shouldRespondInChat({} as never, policy)).toBe(false);
  });

  it("stripBotMention removes @-handle case-insensitively", () => {
    expect(stripBotMention("hey @Theo_Paulo_Bot can you help?", "theo_paulo_bot")).toBe(
      "hey  can you help?",
    );
  });
});
