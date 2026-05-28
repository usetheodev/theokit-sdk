/**
 * `MattermostAdapter` — implements BasePlatformAdapter over Client4 + WS.
 * ADRs D397-D404.
 *
 * @public
 */

import {
  BasePlatformAdapter,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@usetheo/gateway";

import {
  type ConnectOptions,
  connectMattermost,
  getChannelCached,
  type MattermostClientHandle,
  type WSMessage,
} from "./client.js";
import { ConfigurationError } from "./errors.js";
import { shouldRespond } from "./filters.js";
import { mapChannelType, normalizeMattermostType, postToMessageEvent } from "./normalize.js";
import type { MattermostAdapterOptions, MattermostPost } from "./types.js";

export class MattermostAdapter extends BasePlatformAdapter {
  readonly platform = "mattermost" as const;
  private readonly opts: MattermostAdapterOptions;
  private handle: MattermostClientHandle | undefined;
  private inboundHandler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private wsListener: ((msg: WSMessage) => void) | undefined;
  private connected = false;

  constructor(opts: MattermostAdapterOptions) {
    super();
    if (opts.baseUrl.length === 0) {
      throw new ConfigurationError({
        code: "base_url_required",
        message: 'gateway-mattermost: opts.baseUrl is empty (e.g. "https://mattermost.acme.com")',
      });
    }
    if (opts.accessToken.length === 0) {
      throw new ConfigurationError({
        code: "access_token_required",
        message:
          "gateway-mattermost: opts.accessToken is empty (generate one in System Console → Integrations → Bot Accounts)",
      });
    }
    this.opts = opts;
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    try {
      this.handle = await connectMattermost({
        baseUrl: this.opts.baseUrl,
        accessToken: this.opts.accessToken,
      } satisfies ConnectOptions);
      this.attachWsListener();
      this.connected = true;
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[gateway-mattermost] connect failed: ${msg}\n`);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    if (this.handle !== undefined && this.wsListener !== undefined) {
      this.handle.ws.removeMessageListener(this.wsListener);
    }
    this.handle?.ws.close();
    this.handle = undefined;
    this.wsListener = undefined;
    this.connected = false;
    this.inboundHandler = undefined;
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    if (this.handle === undefined) {
      return {
        ok: false,
        error: { code: "not_connected", message: "MattermostAdapter.connect() not called" },
      };
    }
    try {
      const post = await this.handle.client.createPost({
        channel_id: out.channel.id,
        message: out.text,
        ...(out.channel.type === "thread" && out.channel.topicId !== undefined
          ? { root_id: out.channel.topicId }
          : {}),
      });
      return { ok: true, messageId: post.id };
    } catch (err) {
      return mapMattermostError(err);
    }
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // EC-H: replace, not stack.
    this.inboundHandler = handler;
    return () => {
      if (this.inboundHandler === handler) this.inboundHandler = undefined;
    };
  }

  /** Escape hatch: caller can drive REST directly when v0.1 doesn't expose a feature. */
  getClient(): MattermostClientHandle | undefined {
    return this.handle;
  }

  private attachWsListener(): void {
    if (this.handle === undefined) return;
    const handle = this.handle;
    this.wsListener = (msg: WSMessage) => {
      if (msg.event !== "posted") return;
      void this.processPostedEvent(handle, msg).catch((err: unknown) => {
        const m = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[gateway-mattermost] processPostedEvent failed: ${m}\n`);
      });
    };
    handle.ws.addMessageListener(this.wsListener);
  }

  private async processPostedEvent(handle: MattermostClientHandle, msg: WSMessage): Promise<void> {
    const post = parsePostFromWS(msg);
    if (post === undefined) return;
    const channel = await getChannelCached(handle, post.channel_id);
    const rawType = normalizeMattermostType(channel);
    const channelType = mapChannelType(rawType, post.root_id.length > 0);
    const requireMention = this.opts.requireMention ?? true;
    if (
      !shouldRespond({
        post,
        channelType,
        botUserId: handle.botUserId,
        botUsername: handle.botUsername,
        requireMention,
      })
    ) {
      return;
    }
    const senderUsername =
      typeof msg.data.sender_name === "string"
        ? (msg.data.sender_name as string).replace(/^@/, "")
        : undefined;
    const event = postToMessageEvent(post, channel, senderUsername);
    if (this.inboundHandler === undefined) return;
    try {
      await this.inboundHandler(event);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[gateway-mattermost] handler threw: ${m}\n`);
    }
  }
}

/**
 * Parse the `data.post` JSON envelope from a Mattermost WS `posted` event.
 *
 * @public — exposed so consumers can drive their own WS listener too.
 */
export function parsePostFromWS(msg: WSMessage): MattermostPost | undefined {
  const raw = msg.data?.post;
  if (typeof raw !== "string") return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<MattermostPost>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.user_id !== "string" ||
      typeof parsed.channel_id !== "string" ||
      typeof parsed.message !== "string"
    ) {
      return undefined;
    }
    return {
      id: parsed.id,
      user_id: parsed.user_id,
      channel_id: parsed.channel_id,
      root_id: typeof parsed.root_id === "string" ? parsed.root_id : "",
      message: parsed.message,
      create_at: typeof parsed.create_at === "number" ? parsed.create_at : 0,
      metadata: parsed.metadata,
    };
  } catch {
    return undefined;
  }
}

interface MattermostRestError {
  status_code?: number;
  message?: string;
}

function mapMattermostError(err: unknown): SendResult {
  const e = err as MattermostRestError;
  const status = e.status_code ?? 0;
  if (status === 429) {
    return {
      ok: false,
      error: { code: "rate_limit", message: e.message ?? "Mattermost rate limit" },
    };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      error: {
        code: "permission_denied",
        message: e.message ?? "Mattermost auth/permission error",
      },
    };
  }
  if (status === 400) {
    return {
      ok: false,
      error: { code: "invalid_request", message: e.message ?? "Mattermost rejected request" },
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
