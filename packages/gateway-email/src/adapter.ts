/**
 * `EmailAdapter` — Email platform adapter for `@theokit/gateway`
 * (Adoption Roadmap v1.4 #4; ADRs D327-D339).
 *
 * Stack: nodemailer (SMTP) + imapflow (IMAP IDLE) + mailparser (RFC 5322).
 * Inbound: IMAP IDLE preferred (D328), 15s poll fallback.
 * Outbound: SMTP via nodemailer + threading reciprocity (D337).
 *
 * @public
 */

import {
  BasePlatformAdapter,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";

import { mapEmailError } from "./errors.js";
import { isAllowedSender, isAutomatedSender } from "./filters.js";
import { type FetchedMessage, type IImapClient, ImapClient } from "./imap-client.js";
import { normalizeEmail } from "./normalize.js";
import { SeenUidSet } from "./seen-uids.js";
import { type ISmtpClient, SmtpClient } from "./smtp-client.js";
import { ThreadStore } from "./thread-store.js";
import type { EmailAdapterOptions } from "./types.js";

const DEFAULT_POLL_INTERVAL_MS = 15_000;

export class EmailAdapter extends BasePlatformAdapter {
  readonly platform = "email" as const;
  private readonly options: EmailAdapterOptions;
  private readonly seenUids = new SeenUidSet();
  private readonly threadStore = new ThreadStore();
  private imap: IImapClient | undefined;
  private smtp: ISmtpClient | undefined;
  private handler?: (event: GatewayMessageEvent) => Promise<void>;
  private connected = false;
  // EC-4: serialize concurrent _dispatchInbound calls.
  private dispatchQueue: Promise<void> = Promise.resolve();
  private pollTimer: NodeJS.Timeout | undefined;

  constructor(opts: EmailAdapterOptions) {
    super();
    // EC-1 pattern (from Teams): validate non-empty at construction (fail fast).
    for (const k of ["address", "password", "imapHost", "smtpHost"] as const) {
      const v = opts[k];
      if (typeof v !== "string" || v.length === 0) {
        throw new TypeError(`EmailAdapter: ${k} is required and must be a non-empty string`);
      }
    }
    this.options = opts;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: connect orchestrates factory-vs-real, verify(), connect(), IDLE-vs-poll choice, and rollback-on-throw — a linear single-transaction sequence; splitting hurts the disconnect-on-failure invariant.
  async connect(): Promise<boolean> {
    if (this.connected) return true;
    try {
      // Construct clients (test seams allow injection).
      const imapFactory = this.options.__imapFactory as ((cfg: unknown) => IImapClient) | undefined;
      const smtpFactory = this.options.__smtpFactory as ((cfg: unknown) => ISmtpClient) | undefined;
      this.imap =
        imapFactory !== undefined
          ? imapFactory({
              host: this.options.imapHost,
              port: this.options.imapPort ?? 993,
              secure: true,
              auth: { user: this.options.address, pass: this.options.password },
            })
          : new ImapClient({
              host: this.options.imapHost,
              port: this.options.imapPort ?? 993,
              secure: true,
              auth: { user: this.options.address, pass: this.options.password },
            });
      this.smtp =
        smtpFactory !== undefined
          ? smtpFactory({
              host: this.options.smtpHost,
              port: this.options.smtpPort ?? 587,
              secure: (this.options.smtpPort ?? 587) === 465,
              auth: { user: this.options.address, pass: this.options.password },
            })
          : new SmtpClient({
              host: this.options.smtpHost,
              port: this.options.smtpPort ?? 587,
              secure: (this.options.smtpPort ?? 587) === 465,
              auth: { user: this.options.address, pass: this.options.password },
            });
      await this.smtp.verify();
      await this.imap.connect();

      // Start inbound dispatch loop — IDLE if supported, poll otherwise.
      if (this.imap.supportsIdle()) {
        await this.imap.startIdle(() => {
          void this._drainUnseen();
        });
        // Drain anything already UNSEEN before IDLE started.
        await this._drainUnseen();
      } else {
        // Polling fallback.
        await this._drainUnseen();
        const intervalMs = this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.pollTimer = setInterval(() => {
          void this._drainUnseen();
        }, intervalMs);
      }

      this.connected = true;
      return true;
    } catch (err) {
      console.error("[email] connect failed:", err instanceof Error ? err.message : err);
      await this.disconnect().catch(() => {});
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.imap !== undefined) {
      await this.imap.disconnect().catch(() => {});
      this.imap = undefined;
    }
    if (this.smtp !== undefined) {
      await this.smtp.close().catch(() => {});
      this.smtp = undefined;
    }
    this.connected = false;
    this.handler = undefined;
    this.seenUids.clear();
    this.threadStore.clear();
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: send orchestrates input validation + thread-context lookup + Re: prepend + EC-6 references dedup + From: formatting + SMTP-error mapping — each branch is a single-responsibility check; splitting hurts the "one outbound transaction" locality.
  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "Empty text rejected." } };
    }
    if (!this.connected || this.smtp === undefined) {
      return {
        ok: false,
        error: { code: "not_connected", message: "EmailAdapter not connected." },
      };
    }
    const to = out.channel.id;
    const topicId = out.channel.topicId;
    const context = topicId !== undefined ? this.threadStore.lookup(topicId) : undefined;

    let subject = "Message from agent";
    let inReplyTo: string | undefined;
    let references: readonly string[] | undefined;
    if (context !== undefined) {
      subject = context.subject.startsWith("Re:") ? context.subject : `Re: ${context.subject}`;
      inReplyTo = context.lastMessageId;
      // EC-6: dedup the chain.
      references = Array.from(new Set([...context.references, context.lastMessageId]));
    }

    const from =
      this.options.fromName !== undefined
        ? { name: this.options.fromName, address: this.options.address }
        : this.options.address;
    try {
      const messageId = await this.smtp.send({
        from,
        to,
        subject,
        text: out.text,
        ...(inReplyTo !== undefined ? { inReplyTo } : {}),
        ...(references !== undefined ? { references } : {}),
      });
      return { ok: true, messageId };
    } catch (err) {
      return { ok: false, error: mapEmailError(err) };
    }
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // EC-H: replace any previous subscription.
    this.handler = handler;
    return () => {
      this.handler = undefined;
    };
  }

  /** @internal — drain UNSEEN once and dispatch each. */
  private async _drainUnseen(): Promise<void> {
    if (this.imap === undefined) return;
    let messages: FetchedMessage[] = [];
    try {
      messages = await this.imap.fetchUnseen();
    } catch (err) {
      console.error("[email] fetchUnseen failed:", err instanceof Error ? err.message : err);
      return;
    }
    for (const msg of messages) {
      this._dispatchInbound(msg.uid, msg.source, msg.headers);
    }
  }

  /**
   * EC-4: serialize concurrent IDLE dispatches so seen-check is atomic.
   * Fire-and-forget: never throws; errors logged.
   */
  private _dispatchInbound(
    uid: number,
    rawBuffer: Buffer,
    headers: Map<string, string>,
  ): Promise<void> {
    this.dispatchQueue = this.dispatchQueue.then(() =>
      this._dispatchInboundInner(uid, rawBuffer, headers).catch((err) =>
        console.error("[email] dispatch error:", err instanceof Error ? err.message : err),
      ),
    );
    return this.dispatchQueue;
  }

  private async _dispatchInboundInner(
    uid: number,
    rawBuffer: Buffer,
    headers: Map<string, string>,
  ): Promise<void> {
    if (this.seenUids.has(uid)) return;
    this.seenUids.add(uid);

    const event = await normalizeEmail(rawBuffer, {
      botAddress: this.options.address,
      ...(this.options.maxBodyChars !== undefined
        ? { maxBodyChars: this.options.maxBodyChars }
        : {}),
    });

    // EC-1 (CRITICAL): drop own-address loopback BEFORE anything else.
    if (event.email.fromAddress === this.options.address.toLowerCase()) {
      console.warn(`[email] dropped own-address loopback (uid=${uid})`);
      return;
    }
    // D332: drop automated senders unless explicitly allowed.
    if (
      this.options.allowAutomated !== true &&
      isAutomatedSender(event.email.fromAddress, headers)
    ) {
      console.warn(`[email] dropped automated sender: ${event.email.fromAddress}`);
      return;
    }
    // D333 + EC-3: enforce allowlist (both sides normalized via extractAddr).
    if (!isAllowedSender(event.email.fromAddress, this.options.allowedSenders)) {
      console.warn(`[email] sender not in allowlist: ${event.email.fromAddress}`);
      return;
    }
    // Record thread context for outbound reciprocity.
    this.threadStore.recordFromInbound(event);

    if (this.handler !== undefined) await this.handler(event);
  }

  /** Test seams. @internal */
  get _seenUidsSize(): number {
    return this.seenUids.size;
  }
  get _threadStoreSize(): number {
    return this.threadStore.size;
  }
  /** Test seam — wait for queued dispatches to drain. @internal */
  async _drainDispatchQueue(): Promise<void> {
    await this.dispatchQueue;
  }
  /** Test seam — drain IMAP UNSEEN now + flush dispatch queue. @internal */
  async _drainNow(): Promise<void> {
    await this._drainUnseen();
    await this.dispatchQueue;
  }
}
