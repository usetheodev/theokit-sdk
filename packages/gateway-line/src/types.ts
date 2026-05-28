/**
 * Public option types + internal LINE webhook event shapes.
 *
 * Only the subset we actually read from `@line/bot-sdk` is declared
 * here; we keep peer-dep types out of the public surface so consumers
 * can install the LINE SDK at any compatible version.
 *
 * @public
 */

export interface LineAdapterOptions {
  /** From LINE Developers Console → Messaging API → Channel secret. */
  readonly channelSecret: string;
  /** From LINE Developers Console → Messaging API → Channel access token (long-lived). */
  readonly channelAccessToken: string;
  /**
   * Bot's own LINE user id (`Uxxx...`). When set + `requireMention: true`,
   * the adapter checks `botUserId in event.message.mentionees`.
   * When unset, the mention guard is disabled.
   */
  readonly botUserId?: string;
  /** Default `true`. Set `false` to bypass mention enforcement. */
  readonly requireMention?: boolean;
}

/**
 * LINE webhook source object (subset). The 3 source types from the API:
 * `user` (1:1), `group` (multi-user persistent), `room` (multi-user ephemeral).
 *
 * @public
 */
export interface LineSource {
  readonly type: "user" | "group" | "room" | (string & {});
  readonly userId?: string;
  readonly groupId?: string;
  readonly roomId?: string;
}

/**
 * LINE webhook event (subset we read). Real events from `@line/bot-sdk`
 * carry more fields (`timestamp`, `webhookEventId`, etc.) — preserved
 * via `event.line.raw`.
 *
 * @public
 */
export interface LineWebhookEvent {
  readonly type:
    | "message"
    | "follow"
    | "unfollow"
    | "join"
    | "leave"
    | "postback"
    | "beacon"
    | "accountLink"
    | "things"
    | (string & {});
  readonly timestamp?: number;
  readonly source?: LineSource;
  readonly replyToken?: string;
  readonly message?: LineMessage;
  readonly webhookEventId?: string;
}

/**
 * Minimal LINE message shape (text only in v0.1).
 *
 * @public
 */
export interface LineMessage {
  readonly type: "text" | "image" | "audio" | "video" | "sticker" | "location" | (string & {});
  readonly id?: string;
  readonly text?: string;
  readonly mentionees?: ReadonlyArray<{
    readonly index: number;
    readonly length: number;
    readonly userId?: string;
  }>;
}

/** Webhook request envelope `{ destination, events: [...] }`. */
export interface LineWebhookEnvelope {
  readonly destination?: string;
  readonly events: ReadonlyArray<LineWebhookEvent>;
}
