/**
 * Tests for normalizeSlackEvent — channel type mapping, bot loop guard,
 * mention guard (D285), thread topicId.
 */

import { describe, expect, it } from "vitest";
import { type BoltMessageBody, normalizeSlackEvent } from "../src/normalize.js";

const BOT = "UBOT1234";

function mkBody(
  event: Partial<BoltMessageBody["event"]> & { ts: string; channel: string },
): BoltMessageBody {
  return {
    team_id: "T123",
    event: {
      type: "message",
      ...event,
    },
  };
}

describe("normalizeSlackEvent — channel types (D270, D271)", () => {
  it("DM → channel.type = dm", () => {
    const r = normalizeSlackEvent(
      mkBody({ channel: "D1", ts: "100.1", user: "U1", text: "hi", channel_type: "im" }),
      BOT,
      { requireMention: false },
    );
    expect(r?.channel.type).toBe("dm");
    expect(r?.channel.topicId).toBeUndefined();
  });

  it("public channel mention → channel.type = group", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        user: "U1",
        text: `<@${BOT}> hello`,
        channel_type: "channel",
      }),
      BOT,
    );
    expect(r?.channel.type).toBe("group");
  });

  it("mpim (multi-DM) → channel.type = group", () => {
    const r = normalizeSlackEvent(
      mkBody({ channel: "G1", ts: "100.1", user: "U1", text: "hi", channel_type: "mpim" }),
      BOT,
    );
    expect(r?.channel.type).toBe("group");
  });

  it("thread reply → channel.type = thread + topicId = thread_ts (D271)", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "200.1",
        thread_ts: "100.1",
        user: "U1",
        text: "follow-up",
        channel_type: "channel",
      }),
      BOT,
      { requireMention: false },
    );
    expect(r?.channel.type).toBe("thread");
    expect(r?.channel.topicId).toBe("100.1");
    expect(r?.slack.threadTs).toBe("100.1");
  });
});

describe("normalizeSlackEvent — bot loop guard (D275)", () => {
  it("drops messages where user equals botUserId", () => {
    const r = normalizeSlackEvent(
      mkBody({ channel: "D1", ts: "100.1", user: BOT, text: "self echo", channel_type: "im" }),
      BOT,
    );
    expect(r).toBeUndefined();
  });

  it("drops bot_message subtype", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        bot_id: "B1",
        subtype: "bot_message",
        text: "from another bot",
        channel_type: "channel",
      }),
      BOT,
    );
    expect(r).toBeUndefined();
  });

  it("drops edited messages and other non-user subtypes", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        user: "U1",
        text: "edited",
        subtype: "message_changed",
        channel_type: "channel",
      }),
      BOT,
    );
    expect(r).toBeUndefined();
  });

  it("keeps thread_broadcast subtype (legit reply broadcast)", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "200.1",
        thread_ts: "100.1",
        user: "U1",
        text: `<@${BOT}> shared back to channel`,
        subtype: "thread_broadcast",
        channel_type: "channel",
      }),
      BOT,
    );
    expect(r).toBeDefined();
    expect(r?.slack.subtype).toBe("thread_broadcast");
  });
});

describe("normalizeSlackEvent — mention guard (D285 / EC-3)", () => {
  it("default requireMention=true drops public-channel msg without @bot", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        user: "U1",
        text: "just chatting",
        channel_type: "channel",
      }),
      BOT,
    );
    expect(r).toBeUndefined();
  });

  it("default requireMention=true KEEPS public-channel msg WITH @bot", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        user: "U1",
        text: `<@${BOT}> please help`,
        channel_type: "channel",
      }),
      BOT,
    );
    expect(r).toBeDefined();
  });

  it("requireMention=false keeps all channel messages", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        user: "U1",
        text: "just chatting",
        channel_type: "channel",
      }),
      BOT,
      { requireMention: false },
    );
    expect(r).toBeDefined();
  });

  it("DM always passes regardless of mention", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "D1",
        ts: "100.1",
        user: "U1",
        text: "no mention needed in DM",
        channel_type: "im",
      }),
      BOT,
    );
    expect(r).toBeDefined();
  });

  it("mpim always passes regardless of mention", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "G1",
        ts: "100.1",
        user: "U1",
        text: "group dm",
        channel_type: "mpim",
      }),
      BOT,
    );
    expect(r).toBeDefined();
  });
});

describe("normalizeSlackEvent — misc", () => {
  it("returns undefined for non-message event types", () => {
    const r = normalizeSlackEvent(
      // biome-ignore lint/suspicious/noExplicitAny: synthesizing a non-message event
      { team_id: "T", event: { type: "reaction_added", ts: "100", channel: "C1" } as any },
      BOT,
    );
    expect(r).toBeUndefined();
  });

  it("uses 'anonymous' when event.user is absent", () => {
    const r = normalizeSlackEvent(
      mkBody({ channel: "D1", ts: "100.1", text: "hi", channel_type: "im" }),
      BOT,
    );
    expect(r?.sender.id).toBe("anonymous");
    expect(r?.slack.userId).toBe("anonymous");
  });

  it("EC-7: file-only message kept with text: ''", () => {
    const r = normalizeSlackEvent(
      mkBody({ channel: "D1", ts: "100.1", user: "U1", channel_type: "im" }),
      BOT,
    );
    expect(r).toBeDefined();
    expect(r?.text).toBe("");
  });

  it("sender id matches userId field", () => {
    const r = normalizeSlackEvent(
      mkBody({ channel: "D1", ts: "100.1", user: "U42", text: "hi", channel_type: "im" }),
      BOT,
    );
    expect(r?.sender.id).toBe("U42");
    expect(r?.slack.userId).toBe("U42");
  });

  it("sets stable id of form slack-<team>-<channel>-<ts>", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        user: "U1",
        text: `<@${BOT}>`,
        channel_type: "channel",
      }),
      BOT,
    );
    expect(r?.id).toBe("slack-T123-C1-100.1");
  });
});
