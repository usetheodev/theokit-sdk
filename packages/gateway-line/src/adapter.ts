/**
 * `LineAdapter` — implements BasePlatformAdapter over LINE Messaging API.
 * ADRs D405-D412.
 *
 * @public
 */

import {
  BasePlatformAdapter,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@usetheo/gateway";

import { type LineSdkClient, loadLineSdk, makeClient } from "./client.js";
import { ConfigurationError } from "./errors.js";
import { lineEventToMessageEvent } from "./normalize.js";
import { ReplyTokenCache } from "./reply-cache.js";
import { computeLineSignature } from "./signature.js";
import { splitForLine } from "./split.js";
import type { LineAdapterOptions, LineWebhookEnvelope, LineWebhookEvent } from "./types.js";

export class LineAdapter extends BasePlatformAdapter {
  readonly platform = "line" as const;
  private readonly opts: LineAdapterOptions;
  private readonly replyCache = new ReplyTokenCache();
  private client: LineSdkClient | undefined;
  private inboundHandler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;

  constructor(opts: LineAdapterOptions) {
    super();
    if (opts.channelSecret.length === 0) {
      throw new ConfigurationError({
        code: "channel_secret_required",
        message:
          "gateway-line: opts.channelSecret is empty (D408 requires signing — no insecure mode)",
      });
    }
    if (opts.channelAccessToken.length === 0) {
      throw new ConfigurationError({
        code: "access_token_required",
        message: "gateway-line: opts.channelAccessToken is empty",
      });
    }
    this.opts = opts;
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    try {
      const mod = await loadLineSdk();
      this.client = makeClient(mod, {
        channelAccessToken: this.opts.channelAccessToken,
        channelSecret: this.opts.channelSecret,
      });
      this.connected = true;
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[gateway-line] connect failed: ${msg}\n`);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.client = undefined;
    this.inboundHandler = undefined;
    this.replyCache.clear();
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: reply-token-vs-push selection + multipart loop + per-part error mapping is one cohesive send pipeline (D407 + D411); splitting hurts traceability.
  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    if (this.client === undefined) {
      return {
        ok: false,
        error: { code: "not_connected", message: "LineAdapter.connect() not called" },
      };
    }
    // For DMs: channel.id IS the userId. For groups/rooms: channel.id is groupId/roomId — push API still uses the channel id.
    const targetId = out.channel.id;
    const parts = splitForLine(out.text);
    // Reply API: only the FIRST batch can use the one-shot replyToken; subsequent calls fall back to push.
    const token = this.replyCache.take(targetId);
    let lastErr: SendResult | undefined;
    let messageId: string | undefined;
    for (let i = 0; i < parts.length; i++) {
      const messages = [{ type: "text" as const, text: parts[i] ?? "" }];
      const isFirst = i === 0;
      try {
        if (isFirst && token !== undefined) {
          await this.client.replyMessage(token, messages);
        } else {
          if (isFirst && token === undefined) {
            process.stderr.write(
              `[gateway-line] no reply token for ${targetId} — using push API\n`,
            );
          }
          await this.client.pushMessage(targetId, messages);
        }
        messageId = `line-${Date.now()}-${i}`;
      } catch (err) {
        lastErr = mapLineError(err);
        break;
      }
    }
    if (lastErr !== undefined) return lastErr;
    return { ok: true, ...(messageId !== undefined ? { messageId } : {}) };
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // EC-H: replace, not stack.
    this.inboundHandler = handler;
    return () => {
      if (this.inboundHandler === handler) this.inboundHandler = undefined;
    };
  }

  /** Escape hatch: caller drives Flex/Carousel/etc directly. */
  getClient(): LineSdkClient | undefined {
    return this.client;
  }

  /**
   * Webhook entrypoint — called by `createWebhookServer` AFTER signature
   * validation. Iterates LINE's batch envelope and dispatches each event.
   */
  async dispatchWebhookBody(envelope: LineWebhookEnvelope): Promise<void> {
    for (const ev of envelope.events) {
      await this.dispatchSingleEvent(ev);
    }
  }

  private async dispatchSingleEvent(ev: LineWebhookEvent): Promise<void> {
    const normalized = lineEventToMessageEvent(ev);
    if (normalized === undefined) return; // EC-4: silently skip non-message / non-text
    // Cache the reply token (one-shot, 60s TTL) keyed by SENDER userId (replies go to whoever spoke).
    if (ev.replyToken !== undefined && normalized.sender.id.length > 0) {
      this.replyCache.put(normalized.sender.id, ev.replyToken);
    }
    // Mention guard (D409).
    if (!this.passesMentionGuard(normalized)) return;
    if (this.inboundHandler === undefined) return;
    try {
      await this.inboundHandler(normalized);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[gateway-line] handler threw: ${msg}\n`);
    }
  }

  private passesMentionGuard(event: GatewayMessageEvent): boolean {
    if (event.platform !== "line") return true;
    const requireMention = this.opts.requireMention ?? true;
    if (!requireMention) return true;
    if (event.channel.type === "dm") return true;
    if (this.opts.botUserId === undefined) return true; // guard disabled
    return event.line.mentionees.includes(this.opts.botUserId);
  }

  /** Expose channel secret for the webhook server (signature middleware). */
  getChannelSecret(): string {
    return this.opts.channelSecret;
  }

  /** Used by tests to seed the reply cache (no other path exposes raw cache). */
  _cacheReplyToken(userId: string, token: string): void {
    this.replyCache.put(userId, token);
  }
}

interface LineRestError {
  statusCode?: number;
  status?: number;
  message?: string;
  originalError?: { response?: { status?: number } };
}

function mapLineError(err: unknown): SendResult {
  const e = err as LineRestError;
  const status = e.statusCode ?? e.status ?? e.originalError?.response?.status ?? 0;
  if (status === 429) {
    return { ok: false, error: { code: "rate_limit", message: e.message ?? "LINE rate limit" } };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      error: { code: "permission_denied", message: e.message ?? "LINE auth error" },
    };
  }
  if (status === 400) {
    return {
      ok: false,
      error: { code: "invalid_request", message: e.message ?? "LINE rejected request" },
    };
  }
  return {
    ok: false,
    error: {
      code: "send_failed",
      message: e.message ?? (err instanceof Error ? err.message : String(err)),
    },
  };
}

// Re-export for tests + webhook server.
export { computeLineSignature };
