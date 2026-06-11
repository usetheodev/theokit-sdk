/**
 * Backend contract — what each provider impl (twilio / plivo / vonage)
 * must satisfy so `SMSAdapter` can drive it generically.
 *
 * @internal
 */

import type { SendResult } from "@theokit/gateway";

/** Canonical inbound shape every backend produces. */
export interface SMSInbound {
  /** E.164 sender phone. */
  from: string;
  /** E.164 recipient phone (= the bot's number). */
  to: string;
  /** Plain-text message body. */
  body: string;
  /** Provider message id (Twilio MessageSid, Plivo MessageUuid, Vonage messageId). */
  messageId: string;
  /** ms since epoch. */
  receivedAt: number;
  /** Provider-specific raw body — passed through to `event.sms.raw`. */
  raw: unknown;
}

/** Signature verification inputs — headers may be a Node-style record. */
export interface SignatureContext {
  /** Lowercased headers map. */
  readonly headers: Readonly<Record<string, string>>;
  /** Raw request body string (exactly as received). */
  readonly rawBody: string;
  /** Full URL the provider POSTed to (scheme://host[:port]/path). */
  readonly url: string;
}

/** Backend impl contract. */
export interface SMSBackend {
  readonly kind: "twilio" | "plivo" | "vonage";

  /**
   * Establish provider client and any persistent state. Idempotent.
   * Returns `true` on success; never throws on transient failures.
   */
  connect(): Promise<boolean>;

  /** Idempotent teardown. */
  disconnect(): Promise<void>;

  /**
   * Send a single SMS. Multipart segmentation is done by the adapter,
   * so `body` here is one part ≤ 1600 chars.
   */
  sendMessage(to: string, body: string): Promise<SendResult>;

  /** Verify provider-specific signature header. Returns `false` on missing OR invalid. */
  verifySignature(ctx: SignatureContext): boolean;

  /** Parse raw webhook body into canonical {@link SMSInbound}. */
  parseInbound(ctx: SignatureContext): SMSInbound;
}
