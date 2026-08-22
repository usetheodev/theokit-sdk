/**
 * Node `ws` WebSocket adapter (G8 internal) — `@theokit/sdk`.
 *
 * Per ADR D425. Canonical v1.7.0 adapter — wraps `ws.WebSocketServer({ noServer: true })`
 * for explicit HTTP upgrade integration. Dynamic `import('ws')` keeps the lib
 * optional at module-load time + emits an actionable error if the peer is missing.
 *
 * @internal
 */

import { randomUUID } from "node:crypto";
import { SubscriptionError } from "../types.js";
import type { UpgradeContext, WebSocketHandle, WsAdapter } from "./adapter-types.js";

/**
 * Minimal structural shape of the `ws` lib's `WebSocketServer + WebSocket`.
 * Avoids hard-importing types to keep `@types/ws` an optional peer.
 *
 * @internal
 */
interface WsLikeServer {
  handleUpgrade(req: unknown, socket: unknown, head: unknown, cb: (ws: WsLikeSocket) => void): void;
}

interface WsLikeSocket {
  on(event: "message", listener: (data: unknown, isBinary: boolean) => void): void;
  on(event: "close", listener: (code: number, reason: Buffer | Uint8Array | string) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  readyState: 0 | 1 | 2 | 3;
}

interface WsModule {
  WebSocketServer: new (opts: { noServer: true }) => WsLikeServer;
}

let cachedModule: WsModule | null = null;

async function loadWsModule(): Promise<WsModule> {
  if (cachedModule !== null) return cachedModule;
  try {
    // Dynamic import keeps `ws` as a runtime-required peer without hard-binding
    // the module loader. Consumer installs via `pnpm add ws`.
    cachedModule = (await import("ws")) as unknown as WsModule;
    return cachedModule;
  } catch (cause) {
    throw new SubscriptionError(
      "`ws` peer dependency not installed. Run `pnpm add ws @types/ws` to enable the Node WebSocket adapter, or supply a consumer-supplied adapter via createWebSocketServer({ adapter: customAdapter }).",
      { code: "ws_peer_missing", cause },
    );
  }
}

/**
 * Options accepted by {@link createNodeWsAdapter}.
 *
 * @internal
 */
export interface NodeWsAdapterOptions {
  /** Override the connection ID generator. Default: `randomUUID()`. */
  generateConnectionId?: () => string;
}

/**
 * Per-upgrade raw shape — the caller provides the Node `IncomingMessage`,
 * `net.Socket`, and upgrade `head` Buffer captured from the http `upgrade` event.
 *
 * @internal
 */
export interface NodeUpgradeRaw {
  readonly req: unknown; // http.IncomingMessage
  readonly socket: unknown; // net.Socket
  readonly head: unknown; // Buffer
}

/**
 * Create a Node-canonical WS adapter backed by the `ws` lib.
 *
 * @internal
 */
export function createNodeWsAdapter(opts: NodeWsAdapterOptions = {}): WsAdapter {
  const idGen = opts.generateConnectionId ?? (() => randomUUID());
  let serverPromise: Promise<WsLikeServer> | null = null;

  const getServer = (): Promise<WsLikeServer> => {
    if (serverPromise === null) {
      serverPromise = loadWsModule().then((mod) => new mod.WebSocketServer({ noServer: true }));
    }
    return serverPromise;
  };

  return {
    name: "node-ws",
    async upgrade(ctx: UpgradeContext, raw: unknown): Promise<WebSocketHandle | null> {
      const upgradeHeader = ctx.headers.get("upgrade");
      if (upgradeHeader === undefined || upgradeHeader.toLowerCase() !== "websocket") {
        return null;
      }
      const nodeRaw = raw as NodeUpgradeRaw;
      if (
        nodeRaw === null ||
        typeof nodeRaw !== "object" ||
        nodeRaw.req === undefined ||
        nodeRaw.socket === undefined
      ) {
        throw new SubscriptionError(
          "node-ws adapter requires raw = { req, socket, head } from http 'upgrade' event",
          { code: "node_ws_invalid_raw" },
        );
      }
      const server = await getServer();
      const connectionId = idGen();
      return await new Promise<WebSocketHandle>((resolve) => {
        server.handleUpgrade(nodeRaw.req, nodeRaw.socket, nodeRaw.head, (ws) => {
          resolve(wrapSocket(ws, connectionId));
        });
      });
    },
  };
}

function wrapSocket(ws: WsLikeSocket, connectionId: string): WebSocketHandle {
  const handle: WebSocketHandle = {
    connectionId,
    get readyState() {
      return ws.readyState;
    },
    send(data) {
      ws.send(data);
    },
    close(code, reason) {
      ws.close(code, reason);
    },
    onMessage(listener) {
      const wrapped = (data: unknown, isBinary: boolean) => {
        const payload = decodeWsMessage(data, isBinary);
        listener(payload);
      };
      ws.on("message", wrapped);
      // ws emitter has no explicit removeListener in our minimal interface;
      // close + listener leak is acceptable per ws lib semantics — sockets are
      // single-use, and finalization happens when ws GCs the socket.
      return () => {
        /* no-op; listener cleared on socket close per `ws` lib semantics */
      };
    },
    onClose(listener) {
      const wrapped = (code: number, reason: Buffer | Uint8Array | string) => {
        const reasonStr =
          typeof reason === "string"
            ? reason
            : (reason as Uint8Array).length === 0
              ? ""
              : new TextDecoder().decode(reason as Uint8Array);
        listener(code, reasonStr);
      };
      ws.on("close", wrapped);
      return () => {
        /* no-op */
      };
    },
    onError(listener) {
      ws.on("error", listener);
      return () => {
        /* no-op */
      };
    },
  };
  return handle;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: decodeWsMessage branches across Buffer/ArrayBuffer/Uint8Array/string for cross-runtime WS adapters — refactor candidate
function decodeWsMessage(data: unknown, isBinary: boolean): string | Uint8Array {
  if (isBinary) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (Array.isArray(data)) {
      // ws delivers Buffer[] for fragmented messages — concatenate
      const total = data.reduce((acc: number, b: unknown) => acc + (b as Uint8Array).byteLength, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const b of data as Uint8Array[]) {
        out.set(b, offset);
        offset += b.byteLength;
      }
      return out;
    }
    return new Uint8Array(0);
  }
  // Text frame — ws gives Buffer; decode UTF-8.
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return String(data);
}
