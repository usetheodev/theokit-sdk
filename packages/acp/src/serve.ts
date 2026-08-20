/**
 * `serveAcp({ agent })` — top-level entry that wires the ACP server.
 *
 * Constructs `AgentSideConnection` from `@agentclientprotocol/sdk@^0.22`,
 * delegates lifecycle methods to `lifecycle.ts`, and drives the prompt
 * translator from `translator.ts`. Per-invocation state (D356).
 *
 * @public
 */

import { Readable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { resolveAgentFactory } from "./agent-resolver.js";
import {
  buildInitializeResponse,
  handleCancel,
  handleForkSession,
  handleListSessions,
  handleLoadSession,
  handleNewSession,
} from "./lifecycle.js";
import { handlePrompt } from "./prompt-handler.js";
import { SessionStore } from "./session-store.js";
import type { AcpServerOptions, PermissionMode } from "./types.js";

const DEFAULT_MAX_PROMPT_BYTES = 2 * 1024 * 1024;
const DEFAULT_PERMISSION_TIMEOUT_MS = 60_000;
const DEFAULT_PERMISSION_MODE: PermissionMode = "ask";

/**
 * Block on a stdio JSON-RPC ACP server until stdin closes. Returns ONLY
 * after every active session has been disposed (EC-1).
 *
 * @public
 */
export async function serveAcp(options: AcpServerOptions): Promise<void> {
  const log = options.log ?? ((msg: string) => process.stderr.write(`${msg}\n`));
  const factory = resolveAgentFactory(options.agent, { log });
  const store = new SessionStore();
  const maxPromptBytes = options.maxPromptBytes ?? DEFAULT_MAX_PROMPT_BYTES;
  const permissionMode = options.permissionDefault ?? DEFAULT_PERMISSION_MODE;
  const permissionTimeoutMs = options.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;
  const trustedTools = new Set(options.trustedTools ?? []);

  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;

  // Convert Node streams ↔ Web streams for ndJsonStream. process.stdin is
  // a Node Readable; toWeb gives us the WHATWG ReadableStream.
  // For stdout we wrap into a Writable stream that flushes via the Node API.
  const inputWeb = Readable.toWeb(stdin as Readable) as ReadableStream<Uint8Array>;
  const outputWeb = new WritableStream<Uint8Array>({
    write(chunk: Uint8Array): Promise<void> {
      return new Promise((resolve, reject) => {
        const ok = stdout.write(chunk, (err) => (err ? reject(err) : undefined));
        if (ok) resolve();
        else stdout.once("drain", resolve);
      });
    },
  });
  const stream = acp.ndJsonStream(outputWeb, inputWeb);

  const closedPromise = new Promise<void>((resolve) => {
    stdin.once("end", () => resolve());
    stdin.once("close", () => resolve());
  });

  // Construct connection. The agentBuilder is invoked synchronously by the SDK.
  new acp.AgentSideConnection((conn) => {
    return {
      initialize: async (params) =>
        buildInitializeResponse(params, { capabilities: options.capabilities }),

      authenticate: async (_params): Promise<acp.AuthenticateResponse> => {
        // D350 — auth deferred to v0.2; return empty success.
        return {};
      },

      newSession: async (params) => {
        const result = await handleNewSession(params, { factory, store, log });
        if ("error" in result) {
          throw new acp.RequestError(result.error.code, result.error.message);
        }
        return result.response;
      },

      loadSession: async (params) => {
        const result = await handleLoadSession(params, { store, log });
        if ("error" in result) {
          throw new acp.RequestError(result.error.code, result.error.message);
        }
        return result.response;
      },

      unstable_forkSession: async (params) => {
        const result = await handleForkSession(params, { store, log });
        if ("error" in result) {
          throw new acp.RequestError(result.error.code, result.error.message);
        }
        return result.response;
      },

      listSessions: async (params) => handleListSessions(params, store),

      cancel: async (params) => {
        handleCancel(params, { store });
      },

      prompt: async (params) => {
        const result = await handlePrompt(params, {
          store,
          conn,
          maxPromptBytes,
          permissionMode,
          permissionTimeoutMs,
          trustedTools,
          log,
        });
        if ("error" in result) {
          throw new acp.RequestError(result.error.code, result.error.message);
        }
        return result.response;
      },
    };
  }, stream);

  // EC-1: wait for stdin close, then dispose every live session before resolving.
  await closedPromise;
  const sessions = store.list();
  log(`[acp] stdin closed; disposing ${sessions.length} session(s)`);
  await Promise.allSettled(
    sessions.map(async (session) => {
      try {
        await session.agent.dispose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[acp] dispose of ${session.sessionId} threw: ${msg}`);
      }
    }),
  );
}
