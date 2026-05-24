/**
 * `ThreadStore` tests (T3.2 + D337).
 */

import type { EmailMessageEvent } from "@usetheo/gateway";
import { describe, expect, it } from "vitest";

import { ThreadStore } from "../src/thread-store.js";

function makeEvent(overrides: Partial<EmailMessageEvent["email"]> = {}): EmailMessageEvent {
  const email: EmailMessageEvent["email"] = {
    messageId: "msg-1",
    subject: "Hello",
    fromAddress: "alice@example.com",
    recipients: [],
    attachmentCount: 0,
    raw: {},
    ...overrides,
  };
  return {
    id: email.messageId,
    platform: "email",
    sender: { id: email.fromAddress },
    channel: { id: email.fromAddress, type: "dm", topicId: email.messageId },
    text: "hi",
    receivedAt: 0,
    email,
  };
}

describe("ThreadStore", () => {
  it("test_thread_store_records_from_inbound", () => {
    const s = new ThreadStore();
    s.recordFromInbound(makeEvent({ messageId: "m1" }));
    const ctx = s.lookup("m1");
    expect(ctx).toBeDefined();
    expect(ctx?.subject).toBe("Hello");
    expect(ctx?.lastMessageId).toBe("m1");
  });

  it("test_thread_store_lookup_returns_undefined_for_unknown", () => {
    const s = new ThreadStore();
    expect(s.lookup("nonexistent")).toBeUndefined();
  });

  it("test_thread_store_caps_at_1000", () => {
    const s = new ThreadStore();
    for (let i = 0; i < 1100; i += 1) {
      s.recordFromInbound(makeEvent({ messageId: `m-${i}` }));
    }
    expect(s.size).toBeLessThanOrEqual(ThreadStore.MAX_SIZE);
    // Newest preserved.
    expect(s.lookup("m-1099")).toBeDefined();
    // Oldest dropped.
    expect(s.lookup("m-0")).toBeUndefined();
  });

  it("test_thread_store_subject_decoded_from_event", () => {
    const s = new ThreadStore();
    s.recordFromInbound(makeEvent({ messageId: "m1", subject: "Custom Subject" }));
    expect(s.lookup("m1")?.subject).toBe("Custom Subject");
  });

  it("preserves references chain", () => {
    const s = new ThreadStore();
    s.recordFromInbound(makeEvent({ messageId: "m3", references: ["m1", "m2"] }));
    expect(s.lookup("m3")?.references).toEqual(["m1", "m2"]);
  });
});
