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

  it("platform field narrows to teams variant (ADR D325)", () => {
    const e: MessageEvent = {
      id: "tm-1",
      platform: "teams",
      sender: { id: "user-1", displayName: "Alice" },
      channel: { id: "conv-1", type: "dm" },
      text: "hi",
      receivedAt: 0,
      teams: {
        activityId: "act-1",
        conversationId: "conv-1",
        conversationType: "personal",
        raw: {},
      },
    };
    if (e.platform === "teams") {
      expect(e.teams.conversationType).toBe("personal");
    } else {
      throw new Error("unreachable");
    }
  });

  it("exhaustive switch covers all platforms", () => {
    const teamsEv: MessageEvent = {
      id: "tm-1",
      platform: "teams",
      sender: { id: "u" },
      channel: { id: "c", type: "dm" },
      text: "hi",
      receivedAt: 0,
      teams: {
        activityId: "act-1",
        conversationId: "c",
        conversationType: "personal",
        raw: {},
      },
    };
    const emailEv: MessageEvent = {
      id: "em-1",
      platform: "email",
      sender: { id: "alice@example.com" },
      channel: { id: "alice@example.com", type: "dm", topicId: "msgid-1" },
      text: "hi",
      receivedAt: 0,
      email: {
        messageId: "msgid-1",
        subject: "Hi",
        fromAddress: "alice@example.com",
        recipients: ["bot@example.com"],
        attachmentCount: 0,
        raw: {},
      },
    };
    const events: MessageEvent[] = [
      makeTelegramEvent(),
      makeDiscordEvent(),
      makeWhatsAppEvent(),
      teamsEv,
      emailEv,
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
        case "teams":
          return `tm:${e.teams.conversationId}`;
        case "email":
          return `em:${e.email.messageId}`;
        default: {
          const _exhaustive: never = e;
          throw new Error(`unhandled platform: ${JSON.stringify(_exhaustive)}`);
        }
      }
    });
    expect(ids).toEqual(["tg:200", "dc:cA", "wa:wamid.xxx", "tm:c", "em:msgid-1"]);
  });

  it("platform field narrows to email variant (ADR D339)", () => {
    const e: MessageEvent = {
      id: "em-1",
      platform: "email",
      sender: { id: "alice@example.com" },
      channel: { id: "alice@example.com", type: "dm" },
      text: "hi",
      receivedAt: 0,
      email: {
        messageId: "msgid-1",
        subject: "Hi",
        fromAddress: "alice@example.com",
        recipients: [],
        attachmentCount: 0,
        raw: {},
      },
    };
    if (e.platform === "email") {
      expect(e.email.messageId).toBe("msgid-1");
      expect(e.email.subject).toBe("Hi");
    } else {
      throw new Error("unreachable");
    }
  });
});
