/**
 * `DiscordAdapter` — wraps discord.js in the `@usetheo/gateway`
 * `BasePlatformAdapter` contract (T6.1, ADRs D171, D179).
 *
 * - `connect()` calls `client.login(token)` and awaits the `ready` event.
 * - WebSocket Gateway only (D179) — no webhook variant in v0.1.
 * - Default intents include `MessageContent` (EC-C silent-failure guard).
 * - Bot-to-bot messages ignored at adapter level (`msg.author.bot`).
 * - 2000-char message split (Discord's hard limit).
 *
 * @public
 */

import type { DiscordMessageEvent, MessageEvent as GatewayMessageEvent } from "@usetheo/gateway";
import { BasePlatformAdapter, type OutboundMessage, type SendResult } from "@usetheo/gateway";
import { Client, DiscordAPIError, Events, GatewayIntentBits, type Message } from "discord.js";

export interface DiscordAdapterOptions {
  readonly token: string;
  /**
   * Default: [Guilds, GuildMessages, MessageContent, DirectMessages,
   * DirectMessageReactions]. Without MessageContent the bot receives
   * empty `msg.content` (EC-C silent failure).
   */
  readonly intents?: GatewayIntentBits[];
}

export const DEFAULT_DISCORD_INTENTS: ReadonlyArray<GatewayIntentBits> = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.DirectMessageReactions,
];

const DISCORD_MAX_MESSAGE = 2000;
const SAFE_DISCORD_CHUNK = 1900;

export class DiscordAdapter extends BasePlatformAdapter {
  readonly platform = "discord" as const;
  private readonly client: Client;
  private readonly token: string;
  private handler?: (event: GatewayMessageEvent) => Promise<void>;
  private connected = false;

  constructor(opts: DiscordAdapterOptions) {
    super();
    this.token = opts.token;
    const intents = (opts.intents ?? DEFAULT_DISCORD_INTENTS) as GatewayIntentBits[];
    if (intents.length === 0) {
      process.stderr.write(
        "[discord] WARN — intents:[] passed; bot will not receive message content. Pass at least [Guilds, GuildMessages, MessageContent] (EC-C).\n",
      );
    }
    this.client = new Client({ intents });
    this.client.on(Events.MessageCreate, async (msg) => this.handleInbound(msg));
    this.client.on(Events.Error, (err) => {
      process.stderr.write(`[discord] client error: ${err.message}\n`);
    });
  }

  override async connect(): Promise<boolean> {
    if (this.connected) return true;
    try {
      await new Promise<void>((resolve, reject) => {
        this.client.once(Events.ClientReady, () => resolve());
        this.client.login(this.token).catch(reject);
      });
      this.connected = true;
      return true;
    } catch (err) {
      process.stderr.write(`[discord] connect failed: ${(err as Error).message}\n`);
      return false;
    }
  }

  override async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    try {
      await this.client.destroy();
    } catch {
      /* ignore */
    }
  }

  /**
   * Expose the underlying discord.js `Client` so consumers can register
   * platform-specific events that don't fit the portable contract —
   * `interactionCreate` (slash commands via Application Commands),
   * `error` event boundary, presence updates, etc. Register BEFORE
   * calling `runner.start()`.
   *
   * @public
   */
  getBot(): Client {
    return this.client;
  }

  override async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "text is empty" } };
    }
    let channel: unknown;
    try {
      channel = await this.client.channels.fetch(out.channel.id);
    } catch (err) {
      return {
        ok: false,
        error: { code: "channel_fetch_failed", message: (err as Error).message },
      };
    }
    const sendable = channel as {
      send?: (input: { content: string; reply?: unknown }) => Promise<Message>;
    };
    if (sendable === null || typeof sendable.send !== "function") {
      return {
        ok: false,
        error: {
          code: "channel_not_sendable",
          message: `channel "${out.channel.id}" not text-based or missing`,
        },
      };
    }
    const chunks = splitForDiscord(out.text);
    let lastId: string | undefined;
    for (const chunk of chunks) {
      try {
        const msg = await sendable.send({
          content: chunk,
          ...(out.replyTo !== undefined ? { reply: { messageReference: out.replyTo } } : {}),
        });
        lastId = msg.id;
      } catch (err) {
        return mapSendError(err);
      }
    }
    return { ok: true, ...(lastId !== undefined ? { messageId: lastId } : {}) };
  }

  override onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // EC-H: replace previous handler.
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  private async handleInbound(msg: Message): Promise<void> {
    if (this.handler === undefined) return;
    if (msg.author.bot) return;
    const event = normalizeEvent(msg);
    await this.handler(event);
  }
}

function normalizeEvent(msg: Message): DiscordMessageEvent {
  let channelType: "dm" | "group" | "thread";
  if (msg.guildId === null) {
    channelType = "dm";
  } else if (msg.channel.isThread()) {
    channelType = "thread";
  } else {
    channelType = "group";
  }

  const displayName = msg.author.globalName !== null ? msg.author.globalName : msg.author.username;

  return {
    id: `dc-${msg.channelId}-${msg.id}`,
    platform: "discord",
    sender: {
      id: msg.author.id,
      username: msg.author.username,
      displayName,
    },
    channel: {
      id: msg.channelId,
      type: channelType,
      ...(msg.channel.isThread() ? { topicId: msg.channel.id } : {}),
    },
    text: msg.content,
    receivedAt: msg.createdTimestamp,
    ...(msg.reference?.messageId !== undefined ? { replyTo: msg.reference.messageId } : {}),
    discord: {
      guildId: msg.guildId,
      channelId: msg.channelId,
      messageId: msg.id,
      raw: msg,
    },
  };
}

function splitForDiscord(text: string): string[] {
  if (text.length <= DISCORD_MAX_MESSAGE) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= SAFE_DISCORD_CHUNK) {
      parts.push(remaining);
      break;
    }
    let boundary = remaining.lastIndexOf("\n\n", SAFE_DISCORD_CHUNK);
    if (boundary < SAFE_DISCORD_CHUNK / 2) {
      boundary = remaining.lastIndexOf("\n", SAFE_DISCORD_CHUNK);
    }
    if (boundary < SAFE_DISCORD_CHUNK / 2) boundary = SAFE_DISCORD_CHUNK;
    parts.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary).replace(/^\n+/, "");
  }
  return parts;
}

function mapSendError(err: unknown): SendResult {
  if (err instanceof DiscordAPIError) {
    const codeStr = String(err.code);
    if (codeStr === "50007") {
      return { ok: false, error: { code: "dm_blocked", message: err.message } };
    }
    if (codeStr === "50001" || codeStr === "50013") {
      return { ok: false, error: { code: "no_permission", message: err.message } };
    }
    if (err.status === 429) {
      return { ok: false, error: { code: "rate_limited", message: err.message } };
    }
    return { ok: false, error: { code: `discord_${codeStr}`, message: err.message } };
  }
  return { ok: false, error: { code: "unknown", message: (err as Error).message } };
}
