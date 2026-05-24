/**
 * `EmailAdapter` integration tests (T6.1 + EC-1/EC-3/EC-4/EC-5/EC-6 absorption).
 *
 * Uses fake `IImapClient` + `ISmtpClient` injected via `__imapFactory` / `__smtpFactory`.
 */

import { BasePlatformAdapter, type MessageEvent } from "@usetheo/gateway";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmailAdapter } from "../src/adapter.js";
import type { FetchedMessage, IImapClient } from "../src/imap-client.js";
import type { ISmtpClient, SmtpSendOptions } from "../src/smtp-client.js";

const VALID_OPTS = {
  address: "bot@example.com",
  password: "secret",
  imapHost: "imap.example.com",
  smtpHost: "smtp.example.com",
};

function rfc5322(opts: {
  from: string;
  to?: string;
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  body?: string;
  autoSubmitted?: string;
}): Buffer {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to ?? "bot@example.com"}`,
    `Subject: ${opts.subject ?? "Test"}`,
    `Message-ID: <${opts.messageId ?? "msg-1@example.com"}>`,
  ];
  if (opts.inReplyTo !== undefined) lines.push(`In-Reply-To: <${opts.inReplyTo}>`);
  if (opts.references !== undefined) lines.push(`References: ${opts.references}`);
  if (opts.autoSubmitted !== undefined) lines.push(`Auto-Submitted: ${opts.autoSubmitted}`);
  lines.push("Content-Type: text/plain; charset=utf-8");
  lines.push("");
  lines.push(opts.body ?? "Hello bot");
  return Buffer.from(lines.join("\r\n"), "utf8");
}

class FakeImap implements IImapClient {
  connected = false;
  idleEnabled = true;
  idleOn = false;
  onExists?: () => void;
  queue: FetchedMessage[] = [];
  connectError?: Error;
  // eslint-disable-next-line @typescript-eslint/require-await
  async connect(): Promise<void> {
    if (this.connectError !== undefined) throw this.connectError;
    this.connected = true;
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async disconnect(): Promise<void> {
    this.connected = false;
    this.idleOn = false;
  }
  supportsIdle(): boolean {
    return this.idleEnabled;
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async fetchUnseen(): Promise<FetchedMessage[]> {
    const out = this.queue;
    this.queue = [];
    return out;
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async startIdle(onExists: () => void): Promise<void> {
    this.onExists = onExists;
    this.idleOn = true;
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async stopIdle(): Promise<void> {
    this.idleOn = false;
  }
  /** Test helper: enqueue a message; tests call adapter._drainNow() to consume. */
  push(msg: FetchedMessage): void {
    this.queue.push(msg);
  }
}

class FakeSmtp implements ISmtpClient {
  sent: SmtpSendOptions[] = [];
  verifyError?: Error;
  sendError?: Error;
  returnId = "outbound-1@example.com";
  // eslint-disable-next-line @typescript-eslint/require-await
  async verify(): Promise<true> {
    if (this.verifyError !== undefined) throw this.verifyError;
    return true;
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async send(opts: SmtpSendOptions): Promise<string> {
    if (this.sendError !== undefined) throw this.sendError;
    this.sent.push(opts);
    return this.returnId;
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async close(): Promise<void> {
    /* noop */
  }
}

function mk(extra: Partial<typeof VALID_OPTS> & Record<string, unknown> = {}) {
  const imap = new FakeImap();
  const smtp = new FakeSmtp();
  const adapter = new EmailAdapter({
    ...VALID_OPTS,
    ...extra,
    __imapFactory: () => imap,
    __smtpFactory: () => smtp,
  });
  return { adapter, imap, smtp };
}

describe("EmailAdapter", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("test_adapter_is_base_platform_adapter", () => {
    const { adapter } = mk();
    expect(adapter).toBeInstanceOf(BasePlatformAdapter);
  });

  it("test_adapter_platform_is_email", () => {
    const { adapter } = mk();
    expect(adapter.platform).toBe("email");
  });

  describe("constructor", () => {
    for (const key of ["address", "password", "imapHost", "smtpHost"] as const) {
      it(`throws TypeError when ${key} is empty`, () => {
        expect(() => {
          // @ts-expect-error — deliberately invalid
          new EmailAdapter({ ...VALID_OPTS, [key]: "" });
        }).toThrow(TypeError);
      });
      it(`throws TypeError when ${key} is missing`, () => {
        const opts = { ...VALID_OPTS } as Record<string, string>;
        delete opts[key];
        expect(() => {
          // @ts-expect-error — deliberately invalid
          new EmailAdapter(opts);
        }).toThrow(TypeError);
      });
    }
  });

  describe("connect", () => {
    it("registers IDLE when supported", async () => {
      const { adapter, imap } = mk();
      const ok = await adapter.connect();
      expect(ok).toBe(true);
      expect(imap.idleOn).toBe(true);
      await adapter.disconnect();
    });

    it("falls back to poll when IDLE unsupported", async () => {
      const { adapter, imap } = mk({ pollIntervalMs: 50 });
      imap.idleEnabled = false;
      const ok = await adapter.connect();
      expect(ok).toBe(true);
      expect(imap.idleOn).toBe(false);
      await adapter.disconnect();
    });

    it("returns false on connect failure (D172 contract)", async () => {
      const { adapter, imap } = mk();
      imap.connectError = new Error("network unreachable");
      const ok = await adapter.connect();
      expect(ok).toBe(false);
    });

    it("returns false on SMTP verify failure", async () => {
      const { adapter, smtp } = mk();
      smtp.verifyError = new Error("auth bad");
      const ok = await adapter.connect();
      expect(ok).toBe(false);
    });

    it("is idempotent — second connect returns true without reinit", async () => {
      const { adapter } = mk();
      await adapter.connect();
      const ok2 = await adapter.connect();
      expect(ok2).toBe(true);
      await adapter.disconnect();
    });
  });

  describe("disconnect", () => {
    it("is idempotent before connect", async () => {
      const { adapter } = mk();
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });

    it("clears seen + thread state", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      imap.push({
        uid: 1,
        source: rfc5322({ from: "alice@x.com", messageId: "m1@x.com" }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(adapter._seenUidsSize).toBe(1);
      expect(adapter._threadStoreSize).toBe(1);
      await adapter.disconnect();
      expect(adapter._seenUidsSize).toBe(0);
      expect(adapter._threadStoreSize).toBe(0);
    });
  });

  describe("inbound dispatch", () => {
    it("test_dispatch_drops_own_address_loopback (EC-1 CRITICAL)", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      const received: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        received.push(e);
      });
      // Own-address loopback: From: bot@example.com (same as adapter address).
      imap.push({
        uid: 10,
        source: rfc5322({ from: "bot@example.com", messageId: "loop@x.com" }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(received.length).toBe(0);
      // Thread store also untouched.
      expect(adapter._threadStoreSize).toBe(0);
      await adapter.disconnect();
    });

    it("drops loopback even when From: has display-name + brackets", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      const received: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        received.push(e);
      });
      imap.push({
        uid: 11,
        source: rfc5322({
          from: '"Bot" <bot@example.com>',
          messageId: "loop2@x.com",
        }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(received.length).toBe(0);
      await adapter.disconnect();
    });

    it("filters automated senders by Auto-Submitted header", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      const received: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        received.push(e);
      });
      const headers = new Map([["auto-submitted", "auto-generated"]]);
      imap.push({
        uid: 20,
        source: rfc5322({
          from: "noreply@external.com",
          messageId: "auto@x.com",
        }),
        headers,
      });
      await adapter._drainNow();
      expect(received.length).toBe(0);
      await adapter.disconnect();
    });

    it("filters noreply From: address", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      const received: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        received.push(e);
      });
      imap.push({
        uid: 21,
        source: rfc5322({
          from: "noreply@external.com",
          messageId: "nr@x.com",
        }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(received.length).toBe(0);
      await adapter.disconnect();
    });

    it("allows automated when allowAutomated: true", async () => {
      const { adapter, imap } = mk({ allowAutomated: true });
      await adapter.connect();
      const received: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        received.push(e);
      });
      imap.push({
        uid: 22,
        source: rfc5322({
          from: "noreply@external.com",
          messageId: "auto2@x.com",
        }),
        headers: new Map([["auto-submitted", "auto-generated"]]),
      });
      await adapter._drainNow();
      expect(received.length).toBe(1);
      await adapter.disconnect();
    });

    it("test_dispatch_filters_disallowed_senders (EC-3 allowlist)", async () => {
      const { adapter, imap } = mk({ allowedSenders: ["alice@x.com"] });
      await adapter.connect();
      const received: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        received.push(e);
      });
      imap.push({
        uid: 30,
        source: rfc5322({ from: "bob@x.com", messageId: "bob@x.com" }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(received.length).toBe(0);
      await adapter.disconnect();
    });

    it("EC-3 allows bracketed allowedSenders entry to match pure-address From:", async () => {
      const { adapter, imap } = mk({
        allowedSenders: ['"Alice" <alice@x.com>'],
      });
      await adapter.connect();
      const received: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        received.push(e);
      });
      imap.push({
        uid: 31,
        source: rfc5322({ from: "alice@x.com", messageId: "a1@x.com" }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(received.length).toBe(1);
      await adapter.disconnect();
    });

    it("test_dispatch_records_thread_context", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      adapter.onInbound(async () => {});
      imap.push({
        uid: 40,
        source: rfc5322({
          from: "alice@x.com",
          subject: "Hello",
          messageId: "thread-a@x.com",
        }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(adapter._threadStoreSize).toBe(1);
      await adapter.disconnect();
    });

    it("dedups by seen UID (no double dispatch)", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      let count = 0;
      adapter.onInbound(async () => {
        count++;
      });
      const msg: FetchedMessage = {
        uid: 50,
        source: rfc5322({ from: "alice@x.com", messageId: "dup@x.com" }),
        headers: new Map(),
      };
      imap.push(msg);
      await adapter._drainNow();
      imap.push(msg);
      await adapter._drainNow();
      expect(count).toBe(1);
      await adapter.disconnect();
    });

    it("test_dispatch_serializes_concurrent_calls (EC-4)", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      const order: number[] = [];
      adapter.onInbound(async (e) => {
        // Race: each dispatch sleeps based on uid. Without serialization,
        // smaller-sleep uids would resolve out of order.
        const event = e as MessageEvent & { email: { messageId: string } };
        const uidStr = event.email.messageId.split("-")[1] ?? "0";
        const uid = Number.parseInt(uidStr, 10);
        await new Promise((r) => setTimeout(r, uid === 1 ? 30 : 5));
        order.push(uid);
      });
      // Fire two concurrent IDLE events. With EC-4, first must finish before second.
      imap.push({
        uid: 1,
        source: rfc5322({ from: "alice@x.com", messageId: "id-1@x.com" }),
        headers: new Map(),
      });
      imap.push({
        uid: 2,
        source: rfc5322({ from: "alice@x.com", messageId: "id-2@x.com" }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(order).toEqual([1, 2]);
      await adapter.disconnect();
    });
  });

  describe("onInbound", () => {
    it("test_oninbound_replaces (EC-H pattern)", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      const first: MessageEvent[] = [];
      const second: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        first.push(e);
      });
      adapter.onInbound(async (e) => {
        second.push(e);
      });
      imap.push({
        uid: 70,
        source: rfc5322({ from: "alice@x.com", messageId: "rep@x.com" }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(first.length).toBe(0);
      expect(second.length).toBe(1);
      await adapter.disconnect();
    });

    it("returned unsubscribe clears handler", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      const got: MessageEvent[] = [];
      const off = adapter.onInbound(async (e) => {
        got.push(e);
      });
      off();
      imap.push({
        uid: 71,
        source: rfc5322({ from: "alice@x.com", messageId: "off@x.com" }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(got.length).toBe(0);
      await adapter.disconnect();
    });
  });

  describe("sendMessage", () => {
    it("rejects empty text without hitting SMTP", async () => {
      const { adapter, smtp } = mk();
      await adapter.connect();
      const res = await adapter.sendMessage({
        platform: "email",
        channel: { id: "alice@x.com", type: "dm" },
        text: "",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("empty_text");
      expect(smtp.sent.length).toBe(0);
      await adapter.disconnect();
    });

    it("rejects when not connected", async () => {
      const { adapter } = mk();
      const res = await adapter.sendMessage({
        platform: "email",
        channel: { id: "alice@x.com", type: "dm" },
        text: "hi",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("not_connected");
    });

    it("returns messageId on success", async () => {
      const { adapter, smtp } = mk();
      await adapter.connect();
      smtp.returnId = "new-out-1@example.com";
      const res = await adapter.sendMessage({
        platform: "email",
        channel: { id: "alice@x.com", type: "dm" },
        text: "hi alice",
      });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.messageId).toBe("new-out-1@example.com");
      expect(smtp.sent.length).toBe(1);
      await adapter.disconnect();
    });

    it("uses default subject when no topicId", async () => {
      const { adapter, smtp } = mk();
      await adapter.connect();
      await adapter.sendMessage({
        platform: "email",
        channel: { id: "alice@x.com", type: "dm" },
        text: "hi",
      });
      expect(smtp.sent[0]?.subject).toBe("Message from agent");
      expect(smtp.sent[0]?.inReplyTo).toBeUndefined();
      expect(smtp.sent[0]?.references).toBeUndefined();
      await adapter.disconnect();
    });

    it("prepends Re: when replying into a thread", async () => {
      const { adapter, imap, smtp } = mk();
      await adapter.connect();
      adapter.onInbound(async () => {});
      imap.push({
        uid: 80,
        source: rfc5322({
          from: "alice@x.com",
          subject: "Hello",
          messageId: "t1@x.com",
        }),
        headers: new Map(),
      });
      await adapter._drainNow();
      await adapter.sendMessage({
        platform: "email",
        channel: { id: "alice@x.com", type: "dm", topicId: "t1@x.com" },
        text: "reply",
      });
      expect(smtp.sent[0]?.subject).toBe("Re: Hello");
      expect(smtp.sent[0]?.inReplyTo).toBe("t1@x.com");
      await adapter.disconnect();
    });

    it("does not double-prepend Re: on an already-Re: subject", async () => {
      const { adapter, imap, smtp } = mk();
      await adapter.connect();
      adapter.onInbound(async () => {});
      imap.push({
        uid: 81,
        source: rfc5322({
          from: "alice@x.com",
          subject: "Re: Hello",
          messageId: "t2@x.com",
        }),
        headers: new Map(),
      });
      await adapter._drainNow();
      await adapter.sendMessage({
        platform: "email",
        channel: { id: "alice@x.com", type: "dm", topicId: "t2@x.com" },
        text: "reply2",
      });
      expect(smtp.sent[0]?.subject).toBe("Re: Hello");
      await adapter.disconnect();
    });

    it("test_send_references_dedup (EC-6)", async () => {
      const { adapter, imap, smtp } = mk();
      await adapter.connect();
      adapter.onInbound(async () => {});
      // Inbound message with references chain that already includes the messageId.
      imap.push({
        uid: 82,
        source: rfc5322({
          from: "alice@x.com",
          subject: "Hi",
          messageId: "t3@x.com",
          references: "<orig@x.com> <t3@x.com>",
        }),
        headers: new Map(),
      });
      await adapter._drainNow();
      await adapter.sendMessage({
        platform: "email",
        channel: { id: "alice@x.com", type: "dm", topicId: "t3@x.com" },
        text: "reply",
      });
      const refs = smtp.sent[0]?.references;
      expect(refs).toBeDefined();
      // No duplicates.
      const set = new Set(refs);
      expect(set.size).toBe(refs?.length);
      // t3@x.com appears exactly once.
      expect(refs?.filter((r) => r === "t3@x.com").length).toBe(1);
      await adapter.disconnect();
    });

    it("maps SMTP auth failure to auth_failed", async () => {
      const { adapter, smtp } = mk();
      await adapter.connect();
      smtp.sendError = Object.assign(new Error("Auth bad"), { code: "EAUTH" });
      const res = await adapter.sendMessage({
        platform: "email",
        channel: { id: "alice@x.com", type: "dm" },
        text: "hi",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("auth_failed");
      await adapter.disconnect();
    });

    it("formats From: as name+address when fromName provided", async () => {
      const { adapter, smtp } = mk({ fromName: "TheoBot" });
      await adapter.connect();
      await adapter.sendMessage({
        platform: "email",
        channel: { id: "alice@x.com", type: "dm" },
        text: "hi",
      });
      const from = smtp.sent[0]?.from;
      expect(from).toEqual({ name: "TheoBot", address: "bot@example.com" });
      await adapter.disconnect();
    });
  });
});
