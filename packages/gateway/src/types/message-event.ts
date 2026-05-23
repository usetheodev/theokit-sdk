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
export type PlatformName = "telegram" | "discord" | "slack" | "whatsapp";

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

/** Slack-specific event variant (ADR D274). */
export interface SlackMessageEvent extends BaseMessageEvent {
  readonly platform: "slack";
  readonly slack: {
    /** Slack workspace id (a.k.a. team_id). May be `undefined` for some legacy events. */
    readonly teamId: string | undefined;
    /** Slack channel id (Cxxxxxxxx | Gxxxxxxxx | Dxxxxxxxx). */
    readonly channelId: string;
    /** Slack user id (Uxxxxxxxx) or `"anonymous"` if absent. */
    readonly userId: string;
    /** Message timestamp = canonical Slack message id. */
    readonly ts: string;
    /** Set only when the message belongs to a thread. */
    readonly threadTs?: string;
    /** Slack message subtype (e.g. `"thread_broadcast"`). */
    readonly subtype?: string;
    /** Raw Bolt event body — narrowed by the adapter package. */
    readonly raw: unknown;
  };
}

/** WhatsApp-specific event variant (ADR D308). */
export interface WhatsAppMessageEvent extends BaseMessageEvent {
  readonly platform: "whatsapp";
  readonly whatsapp: {
    /** WhatsApp message id — `wamid.xxx` for cloud, `msg.id._serialized` for web. */
    readonly wamid: string;
    /** Meta-issued phone-number-id (cloud only; undefined for web bridge). */
    readonly phoneNumberId?: string;
    /** Contact's profile name when Meta provides it. */
    readonly contactName?: string;
    /** Which backend produced this event. */
    readonly backend: "cloud" | "web";
    /** Raw envelope — backend-specific, narrowed by the adapter package. */
    readonly raw: unknown;
  };
}

/** Discriminated union of all platform variants. */
export type MessageEvent =
  | TelegramMessageEvent
  | DiscordMessageEvent
  | SlackMessageEvent
  | WhatsAppMessageEvent;
