/**
 * `WhatsAppCloudBackend` — Meta WhatsApp Business Cloud API backend (ADR D304).
 *
 * `connect()` / `disconnect()` are no-ops (HTTP push via webhook is the only
 * inbound channel). Outbound delegates to `WhatsAppCloudClient`. Inbound
 * dispatch is driven by the user calling `handleWebhookPayload(rawBody, sig)`
 * from inside their HTTP route.
 *
 * @public
 */

import type {
  WhatsAppBackend,
  WhatsAppInboundEvent,
  WhatsAppOutboundMessage,
  WhatsAppSendResult,
  WhatsAppStatusReceipt,
} from "../../backend-types.js";
import { WhatsAppCloudClient } from "./client.js";
import {
  normalizeInboundMessages,
  normalizeStatusReceipts,
  parseWebhookPayload,
  verifyWebhookSignature,
} from "./webhook.js";

export interface WhatsAppCloudBackendOptions {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly appSecret: string;
  readonly apiVersion?: string;
  /** Test seam. */
  readonly fetch?: typeof fetch;
}

export class WhatsAppCloudBackend implements WhatsAppBackend {
  readonly kind = "cloud" as const;
  private readonly client: WhatsAppCloudClient;
  private readonly appSecret: string;
  private inboundHandler?: (event: WhatsAppInboundEvent) => Promise<void>;
  private statusHandler?: (receipt: WhatsAppStatusReceipt) => Promise<void>;

  constructor(opts: WhatsAppCloudBackendOptions) {
    this.client = new WhatsAppCloudClient({
      accessToken: opts.accessToken,
      phoneNumberId: opts.phoneNumberId,
      apiVersion: opts.apiVersion,
      ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    });
    this.appSecret = opts.appSecret;
  }

  // Cloud has no persistent connection — webhook is push, send is HTTP.
  async connect(): Promise<boolean> {
    return true;
  }

  async disconnect(): Promise<void> {
    this.inboundHandler = undefined;
    this.statusHandler = undefined;
  }

  async send(message: WhatsAppOutboundMessage): Promise<WhatsAppSendResult> {
    return this.client.sendText(message.to, message.text, message.isGroup);
  }

  onInbound(handler: (event: WhatsAppInboundEvent) => Promise<void>): () => void {
    this.inboundHandler = handler;
    return () => {
      this.inboundHandler = undefined;
    };
  }

  onStatusReceipt(handler: (receipt: WhatsAppStatusReceipt) => Promise<void>): () => void {
    this.statusHandler = handler;
    return () => {
      this.statusHandler = undefined;
    };
  }

  /**
   * Webhook entrypoint. The user calls this from inside their POST /webhook
   * route after `verifyWebhookSubscription` on GET.
   *
   * @returns `true` if signature valid + dispatched (or empty payload).
   *          `false` if signature invalid (route should return 401).
   */
  async handleWebhookPayload(rawBody: Buffer | string, signatureHeader: string | undefined): Promise<boolean> {
    if (!verifyWebhookSignature(rawBody, signatureHeader, this.appSecret)) {
      return false;
    }
    const json = JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")) as unknown;
    const envelope = parseWebhookPayload(json);
    if (envelope === null) return true; // valid signature, unrecognized shape — nothing to dispatch
    const inbounds = normalizeInboundMessages(envelope);
    for (const event of inbounds) {
      if (this.inboundHandler !== undefined) {
        await this.inboundHandler(event);
      }
    }
    const statuses = normalizeStatusReceipts(envelope);
    for (const receipt of statuses) {
      if (this.statusHandler !== undefined) {
        await this.statusHandler(receipt);
      }
    }
    return true;
  }
}
