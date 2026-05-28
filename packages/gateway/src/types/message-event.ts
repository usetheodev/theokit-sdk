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
export type PlatformName =
  | "telegram"
  | "discord"
  | "slack"
  | "whatsapp"
  | "teams"
  | "email"
  | "sms"
  | "mattermost"
  | "line"
  | "matrix";

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

/** Microsoft Teams-specific event variant (ADR D325). */
export interface TeamsMessageEvent extends BaseMessageEvent {
  readonly platform: "teams";
  readonly teams: {
    /** Teams activity id (`MessageActivity.id`). */
    readonly activityId: string;
    /** Teams conversation id. */
    readonly conversationId: string;
    /** Teams conversation classification — open string per SDK type. */
    readonly conversationType: "personal" | "groupChat" | "channel" | (string & {});
    /** Tenant id of the sender (Azure AD). */
    readonly tenantId?: string;
    /** Channel id (only when conversationType === "channel"). */
    readonly channelId?: string;
    /** Team id (only when conversationType === "channel"). */
    readonly teamId?: string;
    /** Raw Teams `MessageActivity` — narrowed by the adapter package. */
    readonly raw: unknown;
  };
}

/** Email-specific event variant (ADR D339). */
export interface EmailMessageEvent extends BaseMessageEvent {
  readonly platform: "email";
  readonly email: {
    /** Message-ID without `<>` braces. Use as `channel.topicId` for threading. */
    readonly messageId: string;
    /** Previous Message-ID this message replies to (without `<>`). */
    readonly inReplyTo?: string;
    /** Full References chain (oldest → newest, no braces). */
    readonly references?: readonly string[];
    /** Decoded Subject (fallback `"(no subject)"`). */
    readonly subject: string;
    /** Sender address (lowercased, normalized). */
    readonly fromAddress: string;
    /** Sender display name when present. */
    readonly fromName?: string;
    /** All To/Cc recipients lowercased; bot's own address EXCLUDED. */
    readonly recipients: readonly string[];
    /** Count of attachments (v0.1 drops payloads — see D335). */
    readonly attachmentCount: number;
    /** Raw `mailparser.ParsedMail` — escape hatch. */
    readonly raw: unknown;
  };
}

/** SMS-specific event variant (ADR D389). */
export interface SMSMessageEvent extends BaseMessageEvent {
  readonly platform: "sms";
  readonly sms: {
    /** Which backend processed this inbound. */
    readonly backend: "twilio" | "plivo" | "vonage";
    /** Provider message id (Twilio MessageSid, Plivo MessageUuid, Vonage messageId). */
    readonly messageId: string;
    /** Sender phone in E.164 format (D391). */
    readonly from: string;
    /** Recipient phone in E.164 format (D391). */
    readonly to: string;
    /** Raw webhook payload — backend-specific, narrowed by the adapter package. */
    readonly raw: unknown;
  };
}

/** Mattermost-specific event variant (ADR D397). */
export interface MattermostMessageEvent extends BaseMessageEvent {
  readonly platform: "mattermost";
  readonly mattermost: {
    /** Mattermost post id. */
    readonly postId: string;
    /** Channel id (Mattermost internal id). */
    readonly channelId: string;
    /** Team id the channel belongs to. */
    readonly teamId: string;
    /** When set, the message is a thread reply rooted at this post id (D399). */
    readonly rootId?: string;
    /** Original Mattermost channel type (`D`/`G`/`O`/`P`) before normalization (D402). */
    readonly channelType: "D" | "G" | "O" | "P" | (string & {});
    /** Raw `@mattermost/client` Post — escape hatch. */
    readonly raw: unknown;
  };
}

/** LINE-specific event variant (ADR D405). */
export interface LineMessageEvent extends BaseMessageEvent {
  readonly platform: "line";
  readonly line: {
    /** LINE source classification (D410). */
    readonly sourceType: "user" | "group" | "room";
    /** LINE source id (userId / groupId / roomId). */
    readonly sourceId: string;
    /** LINE message id. */
    readonly messageId: string;
    /** UserIds mentioned in the message (D409 — never inline). */
    readonly mentionees: ReadonlyArray<string>;
    /** Reply token (one-shot, 60s TTL). Adapter manages cache — caller should not use directly. */
    readonly replyToken?: string;
    /** Raw LINE webhook event — escape hatch. */
    readonly raw: unknown;
  };
}

/** Matrix-specific event variant (ADR D413). */
export interface MatrixMessageEvent extends BaseMessageEvent {
  readonly platform: "matrix";
  readonly matrix: {
    /** Matrix room id (`!xxx:server`). */
    readonly roomId: string;
    /** Matrix event id (`$xxx:server`). */
    readonly eventId: string;
    /** Number of joined members in the room — used for DM detection (D416). */
    readonly memberCount: number;
    /** Raw `matrix-js-sdk` `MatrixEvent` — escape hatch (D421). */
    readonly raw: unknown;
  };
}

/** Discriminated union of all platform variants. */
export type MessageEvent =
  | TelegramMessageEvent
  | DiscordMessageEvent
  | SlackMessageEvent
  | WhatsAppMessageEvent
  | TeamsMessageEvent
  | EmailMessageEvent
  | SMSMessageEvent
  | MattermostMessageEvent
  | LineMessageEvent
  | MatrixMessageEvent;
