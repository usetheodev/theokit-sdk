/**
 * Wrapper over `@mattermost/client` — lazy import + lifecycle.
 *
 * Owns:
 * - Client4 (REST) for outbound posts + channel/user lookup.
 * - WebSocketClient for real-time `posted` events.
 */

import { SDKNotInstalledError } from "./errors.js";
import type { MattermostChannel, MattermostPost } from "./types.js";

interface Client4Like {
  setUrl(url: string): void;
  setToken(token: string): void;
  getMe(): Promise<{ id: string; username: string }>;
  getChannel(channelId: string): Promise<MattermostChannel>;
  createPost(post: {
    channel_id: string;
    message: string;
    root_id?: string;
  }): Promise<MattermostPost>;
}

interface WebSocketClientLike {
  initialize(url: string, token: string): void;
  addMessageListener(listener: (msg: WSMessage) => void): void;
  removeMessageListener(listener: (msg: WSMessage) => void): void;
  close(): void;
}

export interface WSMessage {
  readonly event: string;
  readonly data: Record<string, unknown>;
  readonly broadcast?: { readonly channel_id?: string; readonly team_id?: string };
}

interface MattermostModule {
  Client4: new () => Client4Like;
  WebSocketClient: new () => WebSocketClientLike;
}

async function loadMattermost(): Promise<MattermostModule> {
  try {
    const mod = await import("@mattermost/client");
    return mod as unknown as MattermostModule;
  } catch {
    throw new SDKNotInstalledError("@mattermost/client");
  }
}

export interface MattermostClientHandle {
  readonly client: Client4Like;
  readonly ws: WebSocketClientLike;
  readonly botUserId: string;
  readonly botUsername: string;
  /** Channel-id LRU cache (max 200) to avoid extra getChannel calls. */
  readonly channelCache: Map<string, MattermostChannel>;
}

export interface ConnectOptions {
  readonly baseUrl: string;
  readonly accessToken: string;
}

export async function connectMattermost(opts: ConnectOptions): Promise<MattermostClientHandle> {
  const mod = await loadMattermost();
  const client = new mod.Client4();
  client.setUrl(opts.baseUrl);
  client.setToken(opts.accessToken);
  const me = await client.getMe();
  const ws = new mod.WebSocketClient();
  const wsUrl = wsUrlFromBase(opts.baseUrl);
  ws.initialize(wsUrl, opts.accessToken);
  return {
    client,
    ws,
    botUserId: me.id,
    botUsername: me.username,
    channelCache: new Map(),
  };
}

/**
 * Convert REST base URL to WebSocket URL:
 *   `https://x.com` → `wss://x.com/api/v4/websocket`
 *   `http://localhost:8065` → `ws://localhost:8065/api/v4/websocket`
 *
 * @public — exported for unit tests + consumer-side reuse.
 */
export function wsUrlFromBase(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  const wsScheme = trimmed.startsWith("https://") ? "wss://" : "ws://";
  const hostPart = trimmed.replace(/^https?:\/\//, "");
  return `${wsScheme}${hostPart}/api/v4/websocket`;
}

export async function getChannelCached(
  handle: MattermostClientHandle,
  channelId: string,
): Promise<MattermostChannel | undefined> {
  const cached = handle.channelCache.get(channelId);
  if (cached !== undefined) return cached;
  try {
    const channel = await handle.client.getChannel(channelId);
    // LRU cap: drop oldest when full.
    if (handle.channelCache.size >= 200) {
      const firstKey = handle.channelCache.keys().next().value;
      if (firstKey !== undefined) handle.channelCache.delete(firstKey);
    }
    handle.channelCache.set(channelId, channel);
    return channel;
  } catch {
    return undefined;
  }
}
