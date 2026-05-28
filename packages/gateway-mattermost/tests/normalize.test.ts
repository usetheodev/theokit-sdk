import { describe, expect, it } from "vitest";

import { mapChannelType, normalizeMattermostType, postToMessageEvent } from "../src/normalize.js";
import type { MattermostChannel, MattermostPost } from "../src/types.js";

function makePost(overrides: Partial<MattermostPost> = {}): MattermostPost {
  return {
    id: "p1",
    user_id: "u-alice",
    channel_id: "c-1",
    root_id: "",
    message: "hello",
    create_at: 1700000000,
    ...overrides,
  };
}

function makeChannel(type: MattermostChannel["type"]): MattermostChannel {
  return { id: "c-1", team_id: "t-1", type };
}

describe("mapChannelType (D402)", () => {
  it("D → dm", () => {
    expect(mapChannelType("D", false)).toBe("dm");
  });

  it("O → group", () => {
    expect(mapChannelType("O", false)).toBe("group");
  });

  it("G → group", () => {
    expect(mapChannelType("G", false)).toBe("group");
  });

  it("P → group", () => {
    expect(mapChannelType("P", false)).toBe("group");
  });

  it("any type + root_id present → thread (D399)", () => {
    expect(mapChannelType("O", true)).toBe("thread");
  });
});

describe("normalizeMattermostType", () => {
  it("returns underlying type when channel known", () => {
    expect(normalizeMattermostType(makeChannel("P"))).toBe("P");
  });

  it("defaults to O when channel undefined (open assumption)", () => {
    expect(normalizeMattermostType(undefined)).toBe("O");
  });
});

describe("postToMessageEvent", () => {
  it("DM post produces channel.type=dm", () => {
    const event = postToMessageEvent(makePost(), makeChannel("D"), undefined);
    expect(event.platform).toBe("mattermost");
    expect(event.channel.type).toBe("dm");
    expect(event.channel.topicId).toBeUndefined();
    expect(event.mattermost.channelType).toBe("D");
    expect(event.mattermost.rootId).toBeUndefined();
  });

  it("Open channel post → group", () => {
    const event = postToMessageEvent(makePost(), makeChannel("O"), undefined);
    expect(event.channel.type).toBe("group");
    expect(event.mattermost.channelType).toBe("O");
  });

  it("Thread post sets topicId = root_id (D399)", () => {
    const event = postToMessageEvent(makePost({ root_id: "root-1" }), makeChannel("O"), undefined);
    expect(event.channel.type).toBe("thread");
    expect(event.channel.topicId).toBe("root-1");
    expect(event.mattermost.rootId).toBe("root-1");
  });

  it("populates sender + text + receivedAt", () => {
    const event = postToMessageEvent(makePost(), makeChannel("D"), "alice");
    expect(event.sender.id).toBe("u-alice");
    expect(event.sender.username).toBe("alice");
    expect(event.text).toBe("hello");
    expect(event.receivedAt).toBe(1700000000);
  });

  it("falls back to Date.now() when create_at is 0", () => {
    const before = Date.now();
    const event = postToMessageEvent(makePost({ create_at: 0 }), makeChannel("D"), undefined);
    expect(event.receivedAt).toBeGreaterThanOrEqual(before);
  });

  it("teamId comes from channel", () => {
    const event = postToMessageEvent(makePost(), makeChannel("D"), undefined);
    expect(event.mattermost.teamId).toBe("t-1");
  });

  it("preserves raw post for escape hatch", () => {
    const post = makePost();
    const event = postToMessageEvent(post, makeChannel("D"), undefined);
    expect(event.mattermost.raw).toBe(post);
  });
});
