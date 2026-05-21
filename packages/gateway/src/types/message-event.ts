/**
 * `MessageEvent` — canonical inbound shape every adapter emits (T1.1, ADR D173).
 *
 * Discriminated union keyed by `platform`. Platform-specific extensions live
 * in optional sibling fields (`telegram?`, `discord?`) typed by the adapter
 * package. The default narrow pattern is:
 *
 * ```typescript
 * switch (event.platform) {
 *   case "telegram": return event.telegram.threadId; // narrowed
 *   case "discord":  return event.discord.guildId;   // narrowed
 * }
 * ```
 *
 * @public
 */

/** Closed enum of supported transport platforms. */
export type PlatformName = "telegram" | "discord";

/** Fields common to every platform's inbound event. */
export interface BaseMessageEvent {
  /** Stable id used as a session-key segment and for dedup. */
  readonly id: string;
  /** Discriminator. */
  readonly platform: PlatformName;
  /** Sender identity (opaque, platform-namespaced). */
  readonly sender: {
    readonly id: string;
    readonly username?: string;
    readonly displayName?: string;
  };
  /** Channel / chat scope (opaque, platform-namespaced). */
  readonly channel: {
    readonly id: string;
    readonly type: "dm" | "group" | "thread";
    readonly topicId?: string;
  };
  /** Plain-text content (caption for media-only messages; empty string when absent). */
  readonly text: string;
  /** Receipt timestamp (ms since epoch). */
  readonly receivedAt: number;
  /** Optional reply-target message id. */
  readonly replyTo?: string;
}

/** Telegram-specific event variant. */
export interface TelegramMessageEvent extends BaseMessageEvent {
  readonly platform: "telegram";
  readonly telegram: {
    readonly chatId: number;
    readonly messageId: number;
    readonly threadId?: number;
    /** Raw grammy `Context` — narrowed by the adapter package. */
    readonly raw: unknown;
  };
}

/** Discord-specific event variant. */
export interface DiscordMessageEvent extends BaseMessageEvent {
  readonly platform: "discord";
  readonly discord: {
    readonly guildId: string | null;
    readonly channelId: string;
    readonly messageId: string;
    /** Raw discord.js `Message` — narrowed by the adapter package. */
    readonly raw: unknown;
  };
}

/** Discriminated union of all platform variants. */
export type MessageEvent = TelegramMessageEvent | DiscordMessageEvent;
