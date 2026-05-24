/**
 * Normalize tests (T2.3 + EC-3, EC-4, EC-9).
 */

import { describe, expect, it } from "vitest";

import { normalizeTeamsActivity, stripTeamsMentions } from "../src/normalize.js";

describe("normalizeTeamsActivity — channel mapping (D318)", () => {
  it("test_normalize_personal_chat_to_dm", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      text: "hi",
      conversation: { id: "conv-1", conversationType: "personal" },
      from: { id: "u1" },
      timestamp: "2026-05-23T12:00:00.000Z",
    });
    expect(e.channel.type).toBe("dm");
    expect(e.channel.id).toBe("conv-1");
    expect(e.teams.conversationType).toBe("personal");
  });

  it("test_normalize_group_chat_to_group", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "conv-g", conversationType: "groupChat" },
      from: { id: "u1" },
    });
    expect(e.channel.type).toBe("group");
    expect(e.channel.topicId).toBeUndefined();
  });

  it("test_normalize_channel_post_to_group_with_topic", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "conv-c", conversationType: "channel" },
      from: { id: "u1" },
      channelData: {
        channel: { id: "ch-1" },
        team: { id: "team-1" },
      },
    });
    expect(e.channel.type).toBe("group");
    expect(e.channel.topicId).toBe("ch-1");
    expect(e.teams.channelId).toBe("ch-1");
    expect(e.teams.teamId).toBe("team-1");
  });

  it("test_normalize_unknown_conversation_type_defaults_to_dm (EC-3)", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "conv-?", conversationType: "future-type" },
      from: { id: "u1" },
    });
    expect(e.channel.type).toBe("dm");
  });

  it("conversationType undefined entirely falls back to dm without crash (EC-3)", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "conv-?" },
      from: { id: "u1" },
    });
    expect(e.channel.type).toBe("dm");
  });
});

describe("normalizeTeamsActivity — sender fallback chain (EC-4)", () => {
  it("test_normalize_sender_uses_from_id_when_present", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "c", conversationType: "personal" },
      from: { id: "from-1", name: "Alice", aadObjectId: "aad-1" },
    });
    expect(e.sender.id).toBe("from-1");
    expect(e.sender.displayName).toBe("Alice");
  });

  it("test_normalize_sender_falls_back_to_aad (EC-4)", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "c", conversationType: "personal" },
      from: { aadObjectId: "aad-1" },
    });
    expect(e.sender.id).toBe("aad-1");
  });

  it("test_normalize_sender_anonymous_when_no_id (EC-4)", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "c", conversationType: "personal" },
    });
    expect(e.sender.id).toBe("anonymous");
  });
});

describe("normalizeTeamsActivity — preserves raw + timestamp", () => {
  it("test_normalize_preserves_raw_activity", () => {
    const activity = {
      type: "message",
      id: "act-1",
      text: "hi",
      conversation: { id: "c", conversationType: "personal" },
      from: { id: "u1" },
    };
    const e = normalizeTeamsActivity(activity);
    expect(e.teams.raw).toBe(activity);
  });

  it("test_normalize_handles_empty_text", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "c", conversationType: "personal" },
      from: { id: "u1" },
    });
    expect(e.text).toBe("");
  });

  it("uses Date.now when timestamp invalid", () => {
    const before = Date.now();
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "c", conversationType: "personal" },
      from: { id: "u1" },
      timestamp: "not-a-date",
    });
    expect(e.receivedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("stripTeamsMentions", () => {
  it("test_strip_mentions_removes_at_tags", () => {
    expect(stripTeamsMentions("<at>Bot</at> hi")).toBe("Bot hi");
  });

  it("test_strip_mentions_handles_html_attributes (EC-9)", () => {
    expect(
      stripTeamsMentions(
        '<at type="user" mri="29:1abc">Bot</at> hi how are you',
      ),
    ).toBe("Bot hi how are you");
  });

  it("test_strip_mentions_removes_bot_display_name", () => {
    expect(stripTeamsMentions("<at>Bot</at> hello", "Bot")).toBe("hello");
  });

  it("escapes regex special chars in display name", () => {
    expect(stripTeamsMentions("<at>Bot.Co</at> hello", "Bot.Co")).toBe("hello");
  });

  it("collapses whitespace + trims", () => {
    expect(stripTeamsMentions("  <at>Bot</at>    hello   world  ", "Bot")).toBe(
      "hello world",
    );
  });
});
