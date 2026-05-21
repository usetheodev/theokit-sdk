/**
 * `TelegramAdapter` — wraps grammy in the `@usetheo/gateway`
 * `BasePlatformAdapter` contract (T5.1, ADR D171).
 *
 * - `connect()` calls `bot.start()` in the background; never throws on
 *   bad token (EC-I — returns `false`).
 * - `sendMessage` auto-splits text >4096 chars via `splitForTelegram`.
 * - Bot-to-bot loops blocked at the adapter (`ctx.from.is_bot === true`
 *   never reaches the handler) — EC-K.
 * - `normalizeEvent` produces a `TelegramMessageEvent` keyed by
 *   chat/message/thread ids.
 *
 * @public
 */

import type { MessageEvent as GatewayMessageEvent, TelegramMessageEvent } from "@usetheo/gateway";
import { BasePlatformAdapter, type OutboundMessage, type SendResult } from "@usetheo/gateway";
import { Bot, type Context, GrammyError, HttpError } from "grammy";

import { splitForTelegram } from "./split.js";

export interface TelegramAdapterOptions {
  readonly token: string;
  /** Optional allow-list filter applied at the adapter level. */
  readonly allowedUsers?: ReadonlyArray<string>;
}

export class TelegramAdapter extends BasePlatformAdapter {
  readonly platform = "telegram" as const;
  private readonly bot: Bot;
  private readonly allowedUsers: Set<string>;
  private handler?: (event: GatewayMessageEvent) => Promise<void>;
  private connected = false;
  private startPromise?: Promise<void>;

  constructor(opts: TelegramAdapterOptions) {
    super();
    this.bot = new Bot(opts.token);
    this.allowedUsers = new Set(opts.allowedUsers ?? []);
    this.bot.on("message", async (ctx) => this.handleInbound(ctx));
    this.bot.catch((err) => {
      process.stderr.write(`[telegram] bot error: ${(err.error as Error)?.message ?? err}\n`);
    });
  }

  override async connect(): Promise<boolean> {
    if (this.connected) return true;
    try {
      await this.bot.init();
    } catch (err) {
      // EC-I: invalid token → return false, never throw.
      process.stderr.write(`[telegram] connect failed: ${(err as Error).message}\n`);
      return false;
    }
    this.startPromise = this.bot.start({ drop_pending_updates: true }).catch((err) => {
      process.stderr.write(`[telegram] polling stopped: ${(err as Error).message}\n`);
    });
    this.connected = true;
    return true;
  }

  override async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    try {
      await this.bot.stop();
    } catch {
      /* ignore */
    }
    if (this.startPromise !== undefined) {
      await this.startPromise.catch(() => undefined);
      this.startPromise = undefined;
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validation + parse_mode mapping + thread option + chunk loop + error mapping are all single-responsibility branches inline; splitting hurts readability more than the score.
  override async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "text is empty" } };
    }
    const chatIdNum = Number(out.channel.id);
    if (Number.isNaN(chatIdNum)) {
      return {
        ok: false,
        error: { code: "invalid_channel", message: `channel.id "${out.channel.id}" not numeric` },
      };
    }
    const parseMode = mapFormat(out.format);
    const threadId = out.channel.topicId !== undefined ? Number(out.channel.topicId) : undefined;
    const chunks = splitForTelegram(out.text);
    let lastId: string | undefined;
    for (const chunk of chunks) {
      try {
        const msg = await this.bot.api.sendMessage(chatIdNum, chunk, {
          ...(parseMode !== undefined ? { parse_mode: parseMode } : {}),
          ...(threadId !== undefined ? { message_thread_id: threadId } : {}),
          ...(out.replyTo !== undefined
            ? { reply_parameters: { message_id: Number(out.replyTo) } }
            : {}),
        });
        lastId = String(msg.message_id);
      } catch (err) {
        return mapSendError(err);
      }
    }
    return { ok: true, ...(lastId !== undefined ? { messageId: lastId } : {}) };
  }

  override onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // EC-H: replace previous handler (do not stack).
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  override async startTyping(channelId: string): Promise<void> {
    const chatId = Number(channelId);
    if (Number.isNaN(chatId)) return;
    try {
      await this.bot.api.sendChatAction(chatId, "typing");
    } catch {
      /* cosmetic — swallow (EC-O) */
    }
  }

  private async handleInbound(ctx: Context): Promise<void> {
    if (this.handler === undefined) return;
    // EC-K: ignore messages from other bots.
    if (ctx.from?.is_bot === true) return;
    if (this.allowedUsers.size > 0) {
      const senderId = String(ctx.from?.id ?? "");
      if (!this.allowedUsers.has(senderId)) return;
    }
    const event = normalizeEvent(ctx);
    if (event === undefined) return;
    await this.handler(event);
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: shape-mapping function — each branch is a small conditional spread for an optional field; splitting hurts the "one event normalization here" locality.
function normalizeEvent(ctx: Context): TelegramMessageEvent | undefined {
  const chat = ctx.chat;
  const msg = ctx.message;
  if (chat === undefined || msg === undefined) return undefined;

  let channelType: "dm" | "group" | "thread";
  if (chat.type === "private") {
    channelType = "dm";
  } else if (msg.message_thread_id !== undefined) {
    channelType = "thread";
  } else {
    channelType = "group";
  }

  const text = msg.text ?? msg.caption ?? "";
  const senderId = String(ctx.from?.id ?? "anonymous");

  return {
    id: `tg-${chat.id}-${msg.message_id}`,
    platform: "telegram",
    sender: {
      id: senderId,
      ...(ctx.from?.username !== undefined ? { username: ctx.from.username } : {}),
      ...(ctx.from?.first_name !== undefined ? { displayName: ctx.from.first_name } : {}),
    },
    channel: {
      id: String(chat.id),
      type: channelType,
      ...(msg.message_thread_id !== undefined ? { topicId: String(msg.message_thread_id) } : {}),
    },
    text,
    receivedAt: msg.date * 1000,
    ...(msg.reply_to_message?.message_id !== undefined
      ? { replyTo: String(msg.reply_to_message.message_id) }
      : {}),
    telegram: {
      chatId: chat.id,
      messageId: msg.message_id,
      ...(msg.message_thread_id !== undefined ? { threadId: msg.message_thread_id } : {}),
      raw: ctx,
    },
  };
}

function mapFormat(
  format: "plain" | "markdown" | "html" | undefined,
): "Markdown" | "HTML" | undefined {
  if (format === "markdown") return "Markdown";
  if (format === "html") return "HTML";
  return undefined;
}

function mapSendError(err: unknown): SendResult {
  if (err instanceof GrammyError) {
    const description = err.description.toLowerCase();
    if (description.includes("rate limit") || err.error_code === 429) {
      return { ok: false, error: { code: "rate_limited", message: err.description } };
    }
    if (description.includes("forbidden") || err.error_code === 403) {
      return { ok: false, error: { code: "no_permission", message: err.description } };
    }
    if (description.includes("parse")) {
      return { ok: false, error: { code: "markdown_error", message: err.description } };
    }
    return {
      ok: false,
      error: { code: `telegram_${err.error_code}`, message: err.description },
    };
  }
  if (err instanceof HttpError) {
    return { ok: false, error: { code: "network_error", message: err.message } };
  }
  return { ok: false, error: { code: "unknown", message: (err as Error).message } };
}
