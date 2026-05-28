import { describe, expect, it } from "vitest";

import { lineEventToMessageEvent, mapSourceType } from "../src/normalize.js";
import type { LineWebhookEvent } from "../src/types.js";

function textEvent(overrides: Partial<LineWebhookEvent> = {}): LineWebhookEvent {
  return {
    type: "message",
    timestamp: 1700000000000,
    source: { type: "user", userId: "U-alice" },
    replyToken: "rtok",
    message: { type: "text", id: "m-1", text: "hi", mentionees: [] },
    ...overrides,
  };
}

describe("mapSourceType (D410)", () => {
  it("user → dm", () => {
    expect(mapSourceType("user")).toBe("dm");
  });

  it("group → group", () => {
    expect(mapSourceType("group")).toBe("group");
  });

  it("room → group", () => {
    expect(mapSourceType("room")).toBe("group");
  });
});

describe("lineEventToMessageEvent — EC-4 type filter", () => {
  it("filters non-message event (follow)", () => {
    expect(
      lineEventToMessageEvent({ type: "follow", source: { type: "user", userId: "U-a" } }),
    ).toBeUndefined();
  });

  it("filters unfollow event", () => {
    expect(
      lineEventToMessageEvent({ type: "unfollow", source: { type: "user", userId: "U-a" } }),
    ).toBeUndefined();
  });

  it("filters postback event", () => {
    expect(
      lineEventToMessageEvent({ type: "postback", source: { type: "user", userId: "U-a" } }),
    ).toBeUndefined();
  });

  it("filters non-text message (image)", () => {
    const e = textEvent({ message: { type: "image", id: "im-1" } });
    expect(lineEventToMessageEvent(e)).toBeUndefined();
  });

  it("filters when message field is missing", () => {
    const e = textEvent();
    const stripped: LineWebhookEvent = {
      type: e.type,
      ...(e.source !== undefined ? { source: e.source } : {}),
      ...(e.replyToken !== undefined ? { replyToken: e.replyToken } : {}),
      ...(e.timestamp !== undefined ? { timestamp: e.timestamp } : {}),
    };
    expect(lineEventToMessageEvent(stripped)).toBeUndefined();
  });

  it("returns undefined when source.userId/groupId/roomId all missing", () => {
    expect(lineEventToMessageEvent(textEvent({ source: { type: "user" } }))).toBeUndefined();
  });
});

describe("lineEventToMessageEvent — happy paths", () => {
  it("user source → channel.type=dm + sender.id=userId", () => {
    const event = lineEventToMessageEvent(textEvent());
    expect(event?.platform).toBe("line");
    expect(event?.channel.type).toBe("dm");
    expect(event?.sender.id).toBe("U-alice");
    expect(event?.text).toBe("hi");
    if (event?.platform === "line") {
      expect(event.line.sourceType).toBe("user");
      expect(event.line.replyToken).toBe("rtok");
    }
  });

  it("group source → channel.type=group + channel.id=groupId", () => {
    const event = lineEventToMessageEvent(
      textEvent({
        source: { type: "group", groupId: "G-1", userId: "U-alice" },
      }),
    );
    expect(event?.channel.type).toBe("group");
    expect(event?.channel.id).toBe("G-1");
    expect(event?.sender.id).toBe("U-alice");
  });

  it("room source → channel.type=group", () => {
    const event = lineEventToMessageEvent(
      textEvent({
        source: { type: "room", roomId: "R-1", userId: "U-alice" },
      }),
    );
    expect(event?.channel.type).toBe("group");
    expect(event?.channel.id).toBe("R-1");
  });

  it("extracts mentionees array (D409)", () => {
    const event = lineEventToMessageEvent(
      textEvent({
        message: {
          type: "text",
          id: "m-1",
          text: "@bot hi",
          mentionees: [{ index: 0, length: 4, userId: "U-bot" }],
        },
      }),
    );
    if (event?.platform === "line") {
      expect(event.line.mentionees).toEqual(["U-bot"]);
    } else {
      throw new Error("expected line event");
    }
  });

  it("ignores mentionee entries without userId", () => {
    const event = lineEventToMessageEvent(
      textEvent({
        message: {
          type: "text",
          id: "m-1",
          text: "@all hi",
          mentionees: [{ index: 0, length: 4 }], // no userId
        },
      }),
    );
    if (event?.platform === "line") {
      expect(event.line.mentionees).toEqual([]);
    }
  });

  it("preserves raw event in event.line.raw", () => {
    const raw = textEvent();
    const event = lineEventToMessageEvent(raw);
    if (event?.platform === "line") {
      expect(event.line.raw).toBe(raw);
    }
  });
});
