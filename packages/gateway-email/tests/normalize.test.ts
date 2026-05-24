/**
 * Normalize tests (T2.2 + EC-2, EC-5, EC-7).
 */

import { describe, expect, it } from "vitest";

import { normalizeEmail } from "../src/normalize.js";

function makeRawEmail(opts: {
  from?: string;
  to?: string;
  subject?: string;
  messageId?: string;
  body?: string;
  html?: string;
  references?: string;
  inReplyTo?: string;
  date?: string;
}): string {
  const headers: string[] = [
    `From: ${opts.from ?? "alice@example.com"}`,
    `To: ${opts.to ?? "bot@example.com"}`,
  ];
  if (opts.subject !== undefined) headers.push(`Subject: ${opts.subject}`);
  headers.push(`Message-ID: <${opts.messageId ?? "msg-1@example.com"}>`);
  if (opts.inReplyTo !== undefined) headers.push(`In-Reply-To: <${opts.inReplyTo}>`);
  if (opts.references !== undefined) headers.push(`References: ${opts.references}`);
  if (opts.date !== undefined) headers.push(`Date: ${opts.date}`);
  headers.push("MIME-Version: 1.0");
  headers.push(
    opts.html !== undefined
      ? "Content-Type: text/html; charset=utf-8"
      : "Content-Type: text/plain; charset=utf-8",
  );
  const body = opts.html ?? opts.body ?? "Hello bot";
  return [...headers, "", body].join("\r\n");
}

describe("normalizeEmail — basic extraction", () => {
  it("test_normalize_extracts_message_id_without_braces", async () => {
    const e = await normalizeEmail(makeRawEmail({ messageId: "abc@gmail.com" }), {
      botAddress: "bot@example.com",
    });
    expect(e.email.messageId).toBe("abc@gmail.com");
    expect(e.channel.topicId).toBe("abc@gmail.com");
  });

  it("test_normalize_extracts_subject", async () => {
    const e = await normalizeEmail(makeRawEmail({ subject: "Hi there" }), {
      botAddress: "bot@example.com",
    });
    expect(e.email.subject).toBe("Hi there");
  });

  it("test_normalize_missing_subject_fallback (EC-5)", async () => {
    const e = await normalizeEmail(makeRawEmail({ subject: undefined }), {
      botAddress: "bot@example.com",
    });
    expect(e.email.subject).toBe("(no subject)");
  });

  it("test_normalize_extracts_plain_text_body", async () => {
    const e = await normalizeEmail(makeRawEmail({ body: "Plain hello" }), {
      botAddress: "bot@example.com",
    });
    expect(e.text).toContain("Plain hello");
  });

  it("test_normalize_extracts_text_from_html_only", async () => {
    const html = "<p>Hello <b>bot</b></p>";
    const e = await normalizeEmail(makeRawEmail({ html }), {
      botAddress: "bot@example.com",
    });
    // mailparser converts HTML → text
    expect(e.text.length).toBeGreaterThan(0);
    expect(e.text.toLowerCase()).toContain("hello");
  });

  it("test_normalize_html_only_empty_text_does_not_crash (EC-7)", async () => {
    const e = await normalizeEmail(makeRawEmail({ html: "<style>body{}</style>" }), {
      botAddress: "bot@example.com",
    });
    // text may be empty for style-only HTML — must not crash.
    expect(typeof e.text).toBe("string");
  });
});

describe("normalizeEmail — EC-2 body truncation", () => {
  it("test_normalize_body_truncated_at_max_chars (EC-2)", async () => {
    const big = "a".repeat(60_000);
    const e = await normalizeEmail(makeRawEmail({ body: big }), {
      botAddress: "bot@example.com",
    });
    expect(e.text.length).toBeLessThan(big.length);
    expect(e.text).toContain("[truncated");
  });

  it("test_normalize_body_custom_max_chars (EC-2)", async () => {
    const e = await normalizeEmail(makeRawEmail({ body: "x".repeat(500) }), {
      botAddress: "bot@example.com",
      maxBodyChars: 100,
    });
    expect(e.text).toContain("[truncated");
    // Cap + suffix should be ≤ 200 chars (100 body + suffix marker).
    expect(e.text.length).toBeLessThan(300);
  });

  it("test_normalize_body_under_limit_not_modified (EC-2)", async () => {
    const e = await normalizeEmail(makeRawEmail({ body: "short" }), {
      botAddress: "bot@example.com",
      maxBodyChars: 100,
    });
    expect(e.text).not.toContain("[truncated");
  });
});

describe("normalizeEmail — references chain", () => {
  it("test_normalize_references_chain_normalized_to_array", async () => {
    const e = await normalizeEmail(
      makeRawEmail({ references: "<msg-1@x> <msg-2@x>", inReplyTo: "msg-2@x" }),
      { botAddress: "bot@example.com" },
    );
    expect(e.email.references).toEqual(["msg-1@x", "msg-2@x"]);
    expect(e.email.inReplyTo).toBe("msg-2@x");
  });
});

describe("normalizeEmail — sender + recipients", () => {
  it("test_normalize_channel_id_is_lowercased_from_address", async () => {
    const e = await normalizeEmail(makeRawEmail({ from: "Alice@Example.COM" }), {
      botAddress: "bot@example.com",
    });
    expect(e.channel.id).toBe("alice@example.com");
    expect(e.email.fromAddress).toBe("alice@example.com");
  });

  it("test_normalize_excludes_bot_from_recipients", async () => {
    const raw = `From: alice@example.com\r\nTo: bot@example.com, bob@example.com\r\nSubject: Hi\r\nMessage-ID: <a@b>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nhello`;
    const e = await normalizeEmail(raw, { botAddress: "bot@example.com" });
    expect(e.email.recipients).toEqual(["bob@example.com"]);
  });

  it("test_normalize_topic_id_equals_message_id", async () => {
    const e = await normalizeEmail(makeRawEmail({ messageId: "abc@x" }), {
      botAddress: "bot@example.com",
    });
    expect(e.channel.topicId).toBe(e.email.messageId);
  });

  it("test_normalize_reports_attachment_count", async () => {
    const e = await normalizeEmail(makeRawEmail({}), {
      botAddress: "bot@example.com",
    });
    expect(e.email.attachmentCount).toBe(0);
  });
});
