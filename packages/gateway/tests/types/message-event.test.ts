/**
 * Type-only tests for MessageEvent (T1.1, ADR D173).
 *
 * vitest's type test mode is overkill here — we exercise the union with
 * runtime assertions that the discriminator narrows correctly.
 */

import { describe, expect, it } from "vitest";

import type { MessageEvent } from "../../src/types/message-event.js";

function makeTelegramEvent(): MessageEvent {
  return {
    id: "tg-1",
    platform: "telegram",
    sender: { id: "100" },
    channel: { id: "200", type: "dm" },
    text: "hi",
    receivedAt: 0,
    telegram: { chatId: 200, messageId: 1, raw: {} },
  };
}

function makeDiscordEvent(): MessageEvent {
  return {
    id: "dc-1",
    platform: "discord",
    sender: { id: "uA" },
    channel: { id: "cA", type: "group" },
    text: "hi",
    receivedAt: 0,
    discord: { guildId: "g1", channelId: "cA", messageId: "m1", raw: {} },
  };
}

describe("MessageEvent (T1.1)", () => {
  it("platform field narrows to telegram variant", () => {
    const e = makeTelegramEvent();
    if (e.platform === "telegram") {
      // TypeScript narrowed — accessing `.telegram` is OK.
      expect(e.telegram.chatId).toBe(200);
    } else {
      throw new Error("unreachable");
    }
  });

  it("platform field narrows to discord variant", () => {
    const e = makeDiscordEvent();
    if (e.platform === "discord") {
      expect(e.discord.channelId).toBe("cA");
    } else {
      throw new Error("unreachable");
    }
  });

  it("exhaustive switch covers all platforms", () => {
    const events: MessageEvent[] = [makeTelegramEvent(), makeDiscordEvent()];
    const ids = events.map((e): string => {
      if (e.platform === "telegram") return `tg:${e.telegram.chatId}`;
      return `dc:${e.discord.channelId}`;
    });
    expect(ids).toEqual(["tg:200", "dc:cA"]);
  });
});
