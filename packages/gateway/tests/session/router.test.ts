/**
 * Tests for SessionRouter (T2.1, ADR D174 + EC-B topicId fallback).
 */

import { describe, expect, it } from "vitest";

import { defaultStrategy, SessionRouter } from "../../src/session/router.js";
import type { MessageEvent } from "../../src/types/message-event.js";

function tg(channel: MessageEvent["channel"], senderId = "100"): MessageEvent {
  return {
    id: "x",
    platform: "telegram",
    sender: { id: senderId },
    channel,
    text: "",
    receivedAt: 0,
    telegram: { chatId: 1, messageId: 1, raw: {} },
  };
}

function dc(channel: MessageEvent["channel"], senderId = "uA"): MessageEvent {
  return {
    id: "x",
    platform: "discord",
    sender: { id: senderId },
    channel,
    text: "",
    receivedAt: 0,
    discord: { guildId: null, channelId: channel.id, messageId: "m", raw: {} },
  };
}

describe("SessionRouter (T2.1)", () => {
  it("default strategy: telegram DM", () => {
    expect(defaultStrategy(tg({ id: "200", type: "dm" }))).toBe("telegram-dm-100");
  });

  it("default strategy: telegram thread", () => {
    expect(defaultStrategy(tg({ id: "200", type: "thread", topicId: "tA" }))).toBe(
      "telegram-tpc-200-tA",
    );
  });

  it("default strategy: telegram group", () => {
    expect(defaultStrategy(tg({ id: "200", type: "group" }))).toBe("telegram-grp-200-100");
  });

  it("default strategy: discord DM", () => {
    expect(defaultStrategy(dc({ id: "cA", type: "dm" }))).toBe("discord-dm-uA");
  });

  it("default strategy: discord thread", () => {
    expect(defaultStrategy(dc({ id: "cA", type: "thread", topicId: "tZ" }))).toBe(
      "discord-tpc-cA-tZ",
    );
  });

  it("custom strategy overrides default", () => {
    const router = new SessionRouter((e) => `tg-pro-dm-${e.sender.id}`);
    expect(router.resolveAgentId(tg({ id: "200", type: "dm" }))).toBe("tg-pro-dm-100");
  });

  it("sanitize: ids with `-` become `_`", () => {
    expect(defaultStrategy(tg({ id: "200", type: "dm" }, "abc-def"))).toBe("telegram-dm-abc_def");
  });

  it("EC-B: thread without topicId falls back to group key (no `undefined`)", () => {
    const out = defaultStrategy(tg({ id: "200", type: "thread" }));
    expect(out).toBe("telegram-grp-200-100");
    expect(out).not.toContain("undefined");
  });
});
