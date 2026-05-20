import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { isAbsolute } from "node:path";

import { ConfigurationError, NetworkError } from "../../errors.js";
import type {
  McpHttpServerConfig,
  McpServerConfig,
  McpStdioServerConfig,
} from "../../types/mcp.js";
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

export function createMcpClient(name: string, config: McpServerConfig): McpClient {
  if (isStdio(config)) return new StdioMcpClient(name, config);
  return new HttpMcpClient(name, config as McpHttpServerConfig);
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
  private readonly pending = new Map<number, (response: unknown) => void>();
  private buffer = "";

  constructor(
    name: string,
    private readonly config: McpStdioServerConfig,
  ) {
    super();
    this.name = name;
  }

  override async initialize(): Promise<void> {
    // ADR D79-D80: relative MCP `cwd` paths must safe-join under process.cwd()
    // so a malicious `.theokit/mcp.json` cannot point a server process at
    // `../../../etc`. Absolute paths are trusted (user explicitly chose).
    const resolvedCwd = resolveMcpCwd(this.config.cwd);
    const child = spawn(this.config.command, this.config.args ?? [], {
      cwd: resolvedCwd,
      env: { ...process.env, ...(this.config.env ?? {}) },
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.consume(chunk));
    child.stderr.on("data", () => undefined);
    child.on("error", () => {
      for (const resolver of this.pending.values()) {
        resolver({ error: { message: "MCP process crashed" } });
      }
      this.pending.clear();
    });
    await super.initialize();
  }

  async close(): Promise<void> {
    if (this.child === undefined) return;
    this.child.kill("SIGTERM");
    this.child = undefined;
  }

  private consume(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
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
    const resolver = this.pending.get(message.id);
    if (resolver === undefined) return;
    this.pending.delete(message.id);
    resolver(message);
  }

  protected request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.child === undefined) {
      return Promise.reject(
        new ConfigurationError(`MCP ${this.name} is not initialized`, { code: "mcp_not_init" }),
      );
    }
    const id = this.nextId++;
    const payload: RpcRequest = { jsonrpc: "2.0", id, method, params };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return new Promise<unknown>((resolve) => {
      this.pending.set(id, resolve);
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
    const response = await this.fetchImpl(this.config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
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
