/**
 * Theokit/server integration (G8 internal) — `@theokit/sdk`.
 *
 * Per ADR D429 (auto-route via theokit.subscriptions namespace).
 *
 * Scanner emits `.theo/subscriptions.json` mirroring routes/actions manifests.
 * Runtime side (mountSubscriptions) reads manifest at boot, dynamic-imports
 * each descriptor, registers in {@link SubscriptionRuntime}, attaches Node
 * `http.Server` upgrade listener + `/api/subscriptions/{name}` SSE handler.
 *
 * Cross-repo: SDK ships these primitives. theokit-side Vite plugin + dev
 * server wiring lands in a sibling theokit task (cross-repo follow-up
 * documented in EC-7 of the plan).
 *
 * Claim written 2026-06-04 (f8df6284) and NOT re-verified since: whether the sibling task has
 * landed is a fact about another repository, and nobody checked it from here. Re-read EC-7 before
 * trusting this paragraph — a cross-repo "lands soon" is the shape most likely to outlive its own
 * truth, because the person who lands it is not the person reading this.
 *
 * @internal
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type SubscriptionDescriptor, SubscriptionError } from "../types.js";
import {
  type DispatchOptions,
  errorFrame,
  SubscriptionRuntime,
  type WireFrame,
} from "./subscription-runtime.js";
import type { UpgradeContext } from "./types.js";
import { createNodeWsAdapter } from "./ws-adapter-node.js";

/**
 * Manifest entry shape emitted by the scanner.
 *
 * @internal
 */
export interface SubscriptionManifestEntry {
  /** Subscription name (slug derived from file path OR explicit descriptor.name). */
  readonly name: string;
  /** Relative path from manifest's `appDir` to the file exporting the descriptor. */
  readonly path: string;
  /** Export name on the module (`"default"` by convention). */
  readonly exportName: string;
}

/**
 * Manifest emitted at `.theo/subscriptions.json`.
 *
 * @internal
 */
export interface SubscriptionManifest {
  readonly version: 1;
  readonly subscriptions: ReadonlyArray<SubscriptionManifestEntry>;
}

/**
 * Options for {@link scanSubscriptions}.
 *
 * @internal
 */
export interface ScanOptions {
  /** Root directory containing `app/subscriptions/`. */
  readonly appDir: string;
  /** Output manifest path. Defaults to `<appDir>/.theo/subscriptions.json`. */
  readonly outFile?: string;
}

/**
 * Scan `appDir/app/subscriptions/**\/*.ts` for subscription descriptors.
 * Writes manifest to `outFile`. Returns manifest + count.
 *
 * @internal
 */
export async function scanSubscriptions(
  opts: ScanOptions,
): Promise<{ manifest: SubscriptionManifest; outFile: string; count: number }> {
  const appDir = opts.appDir;
  const subscriptionsDir = path.join(appDir, "app", "subscriptions");
  const outFile = opts.outFile ?? path.join(appDir, ".theo", "subscriptions.json");

  let files: string[];
  try {
    files = await walkTsFiles(subscriptionsDir);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      files = [];
    } else {
      throw cause;
    }
  }

  const entries: SubscriptionManifestEntry[] = files.map((file) => {
    const rel = path.relative(appDir, file);
    const name = deriveName(file, subscriptionsDir);
    return { name, path: rel, exportName: "default" };
  });

  const manifest: SubscriptionManifest = { version: 1, subscriptions: entries };

  // Write only if directory exists OR can be created.
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, `${JSON.stringify(manifest, null, 2)}\n`);

  return { manifest, outFile, count: entries.length };
}

function deriveName(file: string, baseDir: string): string {
  const rel = path.relative(baseDir, file);
  return rel
    .replace(/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/, "")
    .replace(/[\\]/g, "/") // windows safety
    .replace(/\/index$/, "")
    .replace(/\//g, ".");
}

async function walkTsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await walkTsFiles(full)));
    } else if (
      ent.isFile() &&
      /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(ent.name) &&
      !ent.name.includes(".test.") &&
      !ent.name.includes(".spec.")
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Options accepted by {@link mountSubscriptions}.
 *
 * @internal
 */
export interface MountOptions {
  /** Pre-loaded manifest (or path to manifest JSON). */
  readonly manifest: SubscriptionManifest | string;
  /** Base dir to resolve manifest entry `path` against. */
  readonly appDir: string;
  /** Existing runtime (optional; created if absent). */
  readonly runtime?: SubscriptionRuntime;
}

/**
 * Mount subscriptions: load manifest, dynamic-import each descriptor file,
 * register in the runtime, return handlers wired for the http server.
 *
 * @internal
 */
export async function mountSubscriptions(opts: MountOptions): Promise<MountedSubscriptions> {
  const manifest =
    typeof opts.manifest === "string"
      ? (JSON.parse(await fs.readFile(opts.manifest, "utf-8")) as SubscriptionManifest)
      : opts.manifest;
  const runtime = opts.runtime ?? new SubscriptionRuntime();
  const loaded: string[] = [];
  for (const entry of manifest.subscriptions) {
    const full = path.join(opts.appDir, entry.path);
    const mod = (await import(pathToFileURL(full).href)) as Record<string, unknown>;
    const descriptor = mod[entry.exportName];
    if (descriptor === undefined || !isSubscriptionDescriptor(descriptor)) {
      throw new SubscriptionError(
        `Subscription file ${entry.path} does not export "${entry.exportName}" as a SubscriptionDescriptor`,
        { code: "subscription_descriptor_invalid" },
      );
    }
    runtime.register(entry.name, descriptor as SubscriptionDescriptor<unknown, unknown>);
    loaded.push(entry.name);
  }
  const wsAdapter = createNodeWsAdapter();
  return {
    runtime,
    loaded,
    handleSseRequest: (req, res) => handleSseRequest(runtime, req, res),
    handleWsUpgrade: async (req, socket, head) => {
      const ctx = nodeRequestToUpgradeContext(req);
      const handle = await wsAdapter.upgrade(ctx, { req, socket, head });
      if (handle === null) {
        (socket as { destroy: () => void }).destroy();
        return;
      }
      wireWsConnection(runtime, handle);
    },
  };
}

/**
 * Returned by {@link mountSubscriptions}.
 *
 * @internal
 */
export interface MountedSubscriptions {
  readonly runtime: SubscriptionRuntime;
  readonly loaded: ReadonlyArray<string>;
  /** Wire as http server `request` listener for `/api/subscriptions/*`. */
  handleSseRequest: (req: unknown, res: unknown) => Promise<void>;
  /** Wire as http server `upgrade` listener. */
  handleWsUpgrade: (req: unknown, socket: unknown, head: unknown) => Promise<void>;
}

function isSubscriptionDescriptor(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const v = value as { input?: unknown; output?: unknown; handler?: unknown };
  return (
    typeof v.input === "object" &&
    v.input !== null &&
    typeof (v.input as { safeParse?: unknown }).safeParse === "function" &&
    typeof v.output === "object" &&
    v.output !== null &&
    typeof (v.output as { safeParse?: unknown }).safeParse === "function" &&
    typeof v.handler === "function"
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: handleSseRequest orchestrates parse + auth + framing + cleanup — refactor candidate
async function handleSseRequest(
  runtime: SubscriptionRuntime,
  reqRaw: unknown,
  resRaw: unknown,
): Promise<void> {
  const req = reqRaw as {
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    on(event: string, cb: () => void): void;
  };
  const res = resRaw as {
    writeHead(code: number, headers?: Record<string, string>): void;
    write(chunk: string | Uint8Array): boolean;
    end(): void;
  };
  if (typeof req.url !== "string") {
    res.writeHead(400, { "content-type": "text/plain" });
    res.write("missing url");
    res.end();
    return;
  }
  const u = new URL(req.url, "http://localhost");
  const match = u.pathname.match(/^\/api\/subscriptions\/([^/]+)$/);
  if (match === null) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.write("not a subscription path");
    res.end();
    return;
  }
  const name = decodeURIComponent(match[1] as string);
  const rawInputStr = u.searchParams.get("input") ?? "null";
  let rawInput: unknown;
  try {
    rawInput = JSON.parse(rawInputStr);
  } catch {
    res.writeHead(400, { "content-type": "text/plain" });
    res.write("invalid input JSON");
    res.end();
    return;
  }
  const lastEventId = pickHeader(req.headers, "last-event-id");
  const ac = new AbortController();
  req.on("close", () => ac.abort());
  const dispatchOpts: DispatchOptions = {
    name,
    rawInput,
    transport: "sse",
    ...(lastEventId !== undefined ? { lastEventId } : {}),
    connectionId: randomUUID(),
    signal: ac.signal,
    disconnect: (_code, _reason) => ac.abort(),
  };
  let result: ReturnType<SubscriptionRuntime["dispatch"]>;
  try {
    result = runtime.dispatch(dispatchOpts);
  } catch (cause) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.write((cause as Error).message);
    res.end();
    return;
  }
  if (result.transport !== "sse") {
    res.writeHead(500, { "content-type": "text/plain" });
    res.write("dispatch returned non-SSE result for SSE request");
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const reader = result.stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) res.write(value);
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}

function wireWsConnection(
  runtime: SubscriptionRuntime,
  handle: import("./types.js").WebSocketHandle,
): void {
  const subs: Map<string, { ac: AbortController; iterable: AsyncIterable<WireFrame> }> = new Map();
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: onMessage callback multiplexes subscribe/abort/resume kinds + per-sub lifecycle — refactor candidate
  handle.onMessage((data) => {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    let msg: { kind?: string; name?: string; input?: unknown; lastEventId?: string };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.kind === "subscribe" && typeof msg.name === "string") {
      const ac = new AbortController();
      const dispatchOpts: DispatchOptions = {
        name: msg.name,
        rawInput: msg.input,
        transport: "ws",
        ...(msg.lastEventId !== undefined ? { lastEventId: msg.lastEventId } : {}),
        connectionId: handle.connectionId,
        signal: ac.signal,
        disconnect: (code, reason) => {
          ac.abort();
          handle.close(code, reason);
        },
      };
      let dispatched: ReturnType<SubscriptionRuntime["dispatch"]>;
      try {
        dispatched = runtime.dispatch(dispatchOpts);
      } catch (cause) {
        handle.send(JSON.stringify(errorFrame(cause)));
        return;
      }
      if (dispatched.transport !== "ws") {
        handle.send(
          JSON.stringify(
            errorFrame(
              new SubscriptionError("non-WS dispatch result for WS request", {
                code: "ws_transport_mismatch",
              }),
            ),
          ),
        );
        return;
      }
      subs.set(msg.name, { ac, iterable: dispatched.iterable });
      void (async () => {
        for await (const frame of dispatched.iterable) {
          handle.send(JSON.stringify(frame));
        }
        subs.delete(msg.name as string);
      })();
    }
    if (msg.kind === "unsubscribe" && typeof msg.name === "string") {
      const entry = subs.get(msg.name);
      entry?.ac.abort();
      subs.delete(msg.name);
    }
  });
  handle.onClose(() => {
    for (const { ac } of subs.values()) ac.abort();
    subs.clear();
  });
}

function nodeRequestToUpgradeContext(reqRaw: unknown): UpgradeContext {
  const req = reqRaw as {
    url?: string;
    headers: Record<string, string | string[] | undefined>;
  };
  const url = new URL(req.url ?? "/", "http://localhost");
  const headers = new Map<string, string>();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k.toLowerCase(), v);
    else if (Array.isArray(v) && v.length > 0) headers.set(k.toLowerCase(), v.join(","));
  }
  return { url, headers };
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = headers[key.toLowerCase()];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0) return v[0];
  return undefined;
}
