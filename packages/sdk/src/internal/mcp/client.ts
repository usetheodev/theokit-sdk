import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { isAbsolute } from "node:path";

import { ConfigurationError, NetworkError } from "../../errors.js";
import type {
  McpHttpServerConfig,
  McpServerConfig,
  McpStdioServerConfig,
} from "../../types/mcp.js";
import { resolveChildEnv } from "../runtime/lifecycle/env-policy.js";
import { safePathJoin } from "../security/path-guard.js";

/**
 * Real MCP client implementing the subset of the 2024-11-05 spec used by the
 * SDK agent loop: `initialize`, `tools/list`, `tools/call`. Both stdio and
 * http transports are wired; sse uses the same wire format as http with a
 * streaming response handled identically by the JSON-RPC reader.
 *
 * @internal
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface McpClient {
  readonly name: string;
  initialize(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult>;
  close(): Promise<void>;
}

export function createMcpClient(
  name: string,
  config: McpServerConfig,
  fetchImpl: typeof fetch = fetch,
): McpClient {
  if (isStdio(config)) return new StdioMcpClient(name, config);
  return new HttpMcpClient(name, config as McpHttpServerConfig, fetchImpl);
}

/** Default per-request MCP timeout (#59). */
const DEFAULT_MCP_TIMEOUT_MS = 30_000;

/** Max buffered stdout bytes before a flooding stdio server is torn down (SEC-M0-04). */
const MAX_STDIO_BUFFER_BYTES = 8 * 1024 * 1024;

/** M2 #59 — reconnect-after-drop bounds. Base for the full-jitter backoff between
 * reconnect attempts, and the max attempts before surfacing a typed error. */
const RECONNECT_BASE_MS = 250;
const MAX_RECONNECT_ATTEMPTS = 2;

/** M2 #59 — full-jitter backoff (AWS Brooker 2015) for the Nth reconnect attempt,
 * then a plain delay. MCP requests carry no AbortSignal so the delay is unabortable. */
function reconnectDelay(attempt: number): Promise<void> {
  const ceiling = RECONNECT_BASE_MS * 2 ** attempt;
  const ms = Math.floor(Math.random() * ceiling);
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/** Typed timeout error shared by both transports (#59). */
function mcpTimeoutError(name: string, timeoutMs: number): NetworkError {
  return new NetworkError(`MCP ${name} request timed out after ${timeoutMs}ms`, {
    code: "mcp_timeout",
  });
}

/**
 * True when a rejected fetch was aborted by our `AbortSignal.timeout` (#59).
 * `AbortSignal.timeout` rejects with a `DOMException` (name `TimeoutError`),
 * which is not always `instanceof Error`, so we inspect `.name` directly.
 */
function isAbortLike(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null || !("name" in cause)) return false;
  const name = (cause as { name: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

type RpcRequester = (method: string, params: Record<string, unknown>) => Promise<unknown>;

async function rpcInitialize(request: RpcRequester): Promise<void> {
  await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    clientInfo: { name: "theokit-sdk", version: "0.0.0" },
  });
}

async function rpcListTools(request: RpcRequester): Promise<McpTool[]> {
  const response = await request("tools/list", {});
  return (response as { result?: { tools?: McpTool[] } }).result?.tools ?? [];
}

async function rpcCallTool(
  request: RpcRequester,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const response = await request("tools/call", { name, arguments: args });
  const result = (response as { result?: McpToolCallResult }).result;
  if (result === undefined) {
    return { content: [{ type: "text", text: "MCP returned empty result" }], isError: true };
  }
  return result;
}

/** Shared base wiring `initialize` / `listTools` / `callTool` onto an
 * abstract RPC `request` implementation. Subclasses define the transport.
 */
abstract class BaseMcpClient implements McpClient {
  abstract readonly name: string;

  abstract close(): Promise<void>;

  protected abstract request(method: string, params: Record<string, unknown>): Promise<unknown>;

  initialize(): Promise<void> {
    return rpcInitialize((method, params) => this.request(method, params));
  }

  listTools(): Promise<McpTool[]> {
    return rpcListTools((method, params) => this.request(method, params));
  }

  callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    return rpcCallTool((method, params) => this.request(method, params), name, args);
  }
}

function isStdio(config: McpServerConfig): config is McpStdioServerConfig {
  if ((config as { type?: string }).type === "stdio") return true;
  return "command" in config && typeof (config as { command?: unknown }).command === "string";
}

interface RpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

class StdioMcpClient extends BaseMcpClient {
  readonly name: string;
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  // #59 — pending requests carry a reject + timer so a silent server times out
  // (typed error), a late reply after timeout is a no-op, and close() settles them.
  private readonly pending = new Map<
    number,
    {
      resolve: (response: unknown) => void;
      reject: (error: unknown) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private buffer = "";
  // M2 #59 — reconnect-after-drop state. `dropped` is set when the child exits
  // unexpectedly OR times out (not via close()); the next request re-spawns with
  // backoff. `reconnectPromise` is a SINGLE in-flight reconnect shared by every
  // concurrent request so parallel tool dispatch after a drop awaits one handshake
  // instead of racing (or spuriously failing with mcp_not_init).
  private dropped = false;
  private reconnectAttempts = 0;
  private reconnectPromise: Promise<void> | undefined;

  constructor(
    name: string,
    private readonly config: McpStdioServerConfig,
  ) {
    super();
    this.name = name;
  }

  private get timeoutMs(): number {
    return this.config.requestTimeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;
  }

  /** Spawn the server child and wire stdout/stderr/error/exit handlers.
   * Shared by `initialize()` and the M2 #59 reconnect path. */
  private spawnChild(): void {
    // ADR D79-D80: relative MCP `cwd` paths must safe-join under process.cwd()
    // so a malicious `.theokit/mcp.json` cannot point a server process at
    // `../../../etc`. Absolute paths are trusted (user explicitly chose).
    const resolvedCwd = resolveMcpCwd(this.config.cwd);
    const child = spawn(this.config.command, this.config.args ?? [], {
      cwd: resolvedCwd,
      // #54 (F-H1) — a third-party MCP server binary must not inherit host
      // secrets. Scrub secret-like vars by default; `config.env` still wins.
      env: resolveChildEnv({ policy: this.config.envPolicy, overrides: this.config.env }),
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.consume(chunk));
    child.stderr.on("data", () => undefined);
    child.on("error", () => {
      this.rejectAllPending(
        new NetworkError(`MCP ${this.name} process crashed`, { code: "mcp_crashed" }),
      );
    });
    // M2 #59 — a clean-exit / close mid-session used to leave pending requests
    // hung forever (a second permanent-hang vector distinct from timeout). Now
    // an unexpected exit of the ACTIVE child rejects all pending with a typed
    // error and marks the client dropped so the next request reconnects. The
    // `this.child === child` guard skips deliberate close()/replace teardowns.
    child.on("exit", () => {
      if (this.child !== child) return;
      this.child = undefined;
      this.dropped = true;
      this.rejectAllPending(
        new NetworkError(`MCP ${this.name} disconnected`, { code: "mcp_disconnected" }),
      );
    });
  }

  override async initialize(): Promise<void> {
    this.spawnChild();
    await super.initialize();
  }

  /** M2 #59 — ensure a live child before a request. Reconnect (bounded, with
   * full-jitter backoff) when the client was dropped; fail fast when never
   * initialized. Concurrent callers share ONE reconnect handshake. */
  private ensureConnected(): Promise<void> {
    if (this.child !== undefined) return Promise.resolve();
    if (!this.dropped) {
      return Promise.reject(
        new ConfigurationError(`MCP ${this.name} is not initialized`, { code: "mcp_not_init" }),
      );
    }
    // Share a single in-flight reconnect across concurrent requests.
    this.reconnectPromise ??= this.reconnect().finally(() => {
      this.reconnectPromise = undefined;
    });
    return this.reconnectPromise;
  }

  private async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      throw new NetworkError(`MCP ${this.name} reconnect exhausted`, { code: "mcp_disconnected" });
    }
    await reconnectDelay(this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.spawnChild();
    // The handshake uses send() directly (child is now live) so it does not
    // re-enter ensureConnected.
    await super.initialize();
    this.dropped = false;
    this.reconnectAttempts = 0;
  }

  async close(): Promise<void> {
    // #59 — settle in-flight requests instead of leaking their timers/promises.
    this.rejectAllPending(new NetworkError(`MCP ${this.name} closed`, { code: "mcp_closed" }));
    // Clear the ref BEFORE kill so the exit handler's `this.child === child`
    // guard treats this as a deliberate close (no drop / no reconnect).
    const child = this.child;
    this.child = undefined;
    this.dropped = false;
    child?.kill("SIGTERM");
  }

  /** Reject + clear every pending request (crash / close). @internal */
  private rejectAllPending(error: NetworkError): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private consume(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    // SEC-M0-04 — a hostile/broken server flooding stdout with no newline must
    // not pin memory. Cap the buffer; on overflow tear the client down.
    if (this.buffer.length > MAX_STDIO_BUFFER_BYTES) {
      this.buffer = "";
      this.rejectAllPending(
        new NetworkError(`MCP ${this.name} exceeded stdout buffer limit`, {
          code: "mcp_buffer_overflow",
        }),
      );
      this.child?.kill("SIGKILL");
      this.child = undefined;
      return;
    }
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) this.handleLine(line);
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let message: { id?: number };
    try {
      message = JSON.parse(line) as { id?: number };
    } catch {
      return;
    }
    if (typeof message.id !== "number") return;
    const entry = this.pending.get(message.id);
    // #59 — a late reply after timeout finds no entry → no-op (never double-settles).
    if (entry === undefined) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    entry.resolve(message);
  }

  protected request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const child = this.child;
    // Happy path stays fully synchronous (no extra `await` tick that could race
    // with a concurrent close()): a live child sends immediately.
    if (child !== undefined) return this.send(child, method, params);
    // M2 #59 — dropped (child exited or timed out): reconnect on this request.
    // Concurrent requests all await the single shared reconnect via ensureConnected.
    if (this.dropped) return this.reconnectAndRequest(method, params);
    // Never initialized.
    return Promise.reject(
      new ConfigurationError(`MCP ${this.name} is not initialized`, { code: "mcp_not_init" }),
    );
  }

  /** M2 #59 — reconnect a dropped client, then send. Separate async path so the
   * happy path above never pays an extra microtask tick. */
  private async reconnectAndRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    await this.ensureConnected();
    const child = this.child;
    if (child === undefined) {
      throw new ConfigurationError(`MCP ${this.name} is not initialized`, { code: "mcp_not_init" });
    }
    return this.send(child, method, params);
  }

  private send(
    child: ChildProcessWithoutNullStreams,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const id = this.nextId++;
    const payload: RpcRequest = { jsonrpc: "2.0", id, method, params };
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    return new Promise<unknown>((resolve, reject) => {
      // #59 — a silent server rejects with a typed timeout and drops the pending
      // entry (no leak) instead of hanging forever. SEC-M0-04 — an unresponsive
      // server is torn down (SIGKILL) so it cannot linger as a zombie / keep
      // flooding stdout past the deadline.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(mcpTimeoutError(this.name, this.timeoutMs));
        this.child?.kill("SIGKILL");
        this.child = undefined;
        // M2 #59 — a timed-out server is a DROP: mark reconnectable (was missing,
        // leaving a timed-out client permanently un-reconnectable) and settle any
        // OTHER in-flight requests with the typed disconnect instead of letting
        // them each wait out their own timeout.
        this.dropped = true;
        this.rejectAllPending(
          new NetworkError(`MCP ${this.name} disconnected`, { code: "mcp_disconnected" }),
        );
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }
}

class HttpMcpClient extends BaseMcpClient {
  readonly name: string;
  private nextId = 1;
  private readonly fetchImpl: typeof fetch;

  constructor(
    name: string,
    private readonly config: McpHttpServerConfig,
    fetchImpl: typeof fetch = fetch,
  ) {
    super();
    this.name = name;
    this.fetchImpl = fetchImpl;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  protected async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const payload: RpcRequest = { jsonrpc: "2.0", id, method, params };
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      ...(this.config.headers ?? {}),
    };
    const timeoutMs = this.config.requestTimeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        // #59 — bound the request; a non-responding endpoint aborts here.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      // #59 — map an abort/timeout to the typed timeout error; surface any other
      // fetch failure unchanged. The http transport is stateless, so a failed
      // request does not "drop" a connection — the next request reconnects
      // inherently (each POST opens a fresh connection). No in-call retry: that
      // would change the M0 error-surfacing contract and add latency to hard
      // failures. Stdio (a persistent child) is where explicit reconnect lives.
      if (isAbortLike(cause)) throw mcpTimeoutError(this.name, timeoutMs);
      throw cause;
    }
    if (!response.ok) {
      throw new NetworkError(`MCP ${this.name} returned ${response.status}`, {
        code: "mcp_http_error",
      });
    }
    return (await response.json()) as unknown;
  }
}

/**
 * Resolve an MCP server `cwd` field safely. Absolute paths are returned
 * as-is (user explicitly chose absolute); relative paths are joined under
 * `process.cwd()` and prefix-checked via `safePathJoin`.
 *
 * @internal
 */
function resolveMcpCwd(configCwd: string | undefined): string {
  if (configCwd === undefined) return process.cwd();
  if (isAbsolute(configCwd)) return configCwd;
  return safePathJoin(process.cwd(), configCwd);
}
