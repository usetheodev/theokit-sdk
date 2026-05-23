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

function makeWhatsAppEvent(): MessageEvent {
  return {
    id: "wa-1",
    platform: "whatsapp",
    sender: { id: "+5511999999999" },
    channel: { id: "+5511999999999", type: "dm" },
    text: "hi",
    receivedAt: 0,
    whatsapp: { wamid: "wamid.xxx", backend: "cloud", raw: {} },
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

  it("platform field narrows to whatsapp variant (ADR D308)", () => {
    const e = makeWhatsAppEvent();
    if (e.platform === "whatsapp") {
      expect(e.whatsapp.wamid).toBe("wamid.xxx");
      expect(e.whatsapp.backend).toBe("cloud");
    } else {
      throw new Error("unreachable");
    }
  });

  it("exhaustive switch covers all platforms", () => {
    const events: MessageEvent[] = [
      makeTelegramEvent(),
      makeDiscordEvent(),
      makeWhatsAppEvent(),
    ];
    const ids = events.map((e): string => {
      switch (e.platform) {
        case "telegram":
          return `tg:${e.telegram.chatId}`;
        case "discord":
          return `dc:${e.discord.channelId}`;
        case "slack":
          return `sl:${e.slack.channelId}`;
        case "whatsapp":
          return `wa:${e.whatsapp.wamid}`;
      }
    });
    expect(ids).toEqual(["tg:200", "dc:cA", "wa:wamid.xxx"]);
  });
});
