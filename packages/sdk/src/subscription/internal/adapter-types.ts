/**
 * WS adapter contract (G8 internal) — `@theokit/sdk`.
 *
 * Per ADR D425. Defines the minimal interface that runtime adapters
 * (Node `ws`, CF Workers WebSocketPair v1.8.x, Bun.serve v1.8.x, etc.)
 * MUST satisfy. Inspired by hono's `WSContextInit` pattern
 * (`references/hono/src/helper/websocket/index.ts:14-99`).
 *
 * @internal
 */

/**
 * Generic websocket handle exposed by an adapter. Decouples consumer code
 * from runtime-specific WS classes (`ws.WebSocket`, browser WebSocket,
 * Cloudflare server-side WebSocket, etc.).
 *
 * @internal
 */
export interface WebSocketHandle {
  /** Send a single message over the connection. */
  send(data: string | Uint8Array): void;
  /** Close the connection with optional close code + reason. */
  close(code?: number, reason?: string): void;
  /** Register a message listener. Returns an unsubscribe function. */
  onMessage(listener: (data: string | Uint8Array) => void): () => void;
  /** Register a close listener. Returns an unsubscribe function. */
  onClose(listener: (code: number, reason: string) => void): () => void;
  /** Register an error listener. Returns an unsubscribe function. */
  onError(listener: (err: Error) => void): () => void;
  /** Stable identifier assigned by the adapter for logging / state lookup. */
  readonly connectionId: string;
  /** Current ready state (mirrors WebSocket.readyState). */
  readonly readyState: 0 | 1 | 2 | 3;
}

/**
 * Upgrade context passed to {@link WsAdapter.upgrade}. Runtime-neutral
 * abstraction over the HTTP request that triggered the upgrade.
 *
 * @internal
 */
export interface UpgradeContext {
  /** Request URL (parsed). */
  readonly url: URL;
  /** Request headers (lowercase keys). */
  readonly headers: ReadonlyMap<string, string>;
}

/**
 * Runtime-specific WS adapter contract.
 *
 * @internal
 */
export interface WsAdapter {
  /** Adapter name for debugging (e.g., `"node-ws"`, `"cloudflare"`, `"bun"`). */
  readonly name: string;
  /**
   * Attempt to upgrade an incoming connection. Returns `null` if the
   * request is not a valid WS upgrade (caller should respond with 400).
   * On success the returned handle is fully initialized.
   */
  upgrade(ctx: UpgradeContext, raw: unknown): Promise<WebSocketHandle | null>;
}
