/**
 * Hono server adapter — mounts a TheoKit agent as Hono middleware (T12.2).
 *
 * Optional peer dep: hono@^4
 *
 * @public
 */

import type { AgentHandlerOptions, AgentLike } from "./types.js";

export function createAgentHandler(agent: AgentLike, opts?: AgentHandlerOptions) {
  const basePath = opts?.basePath ?? "/agent";

  return {
    routes: [
      { method: "POST", path: `${basePath}/send` },
      { method: "GET", path: `${basePath}/stream` },
    ],

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: request routing with method+path matching is inherent
    async handleRequest(req: {
      method: string;
      url: string;
      body?: unknown;
      signal?: AbortSignal;
    }) {
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname;

      if (req.method === "POST" && path === `${basePath}/send`) {
        const body = req.body as { input?: string } | undefined;
        const input = body?.input ?? "";
        try {
          const run = agent.send(input, { signal: req.signal });
          const result = await run.wait();
          return { status: 200, body: result };
        } catch (err) {
          opts?.onError?.(err instanceof Error ? err : new Error(String(err)));
          return { status: 500, body: { error: "internal_error" } };
        }
      }

      if (req.method === "GET" && path === `${basePath}/stream`) {
        const input = url.searchParams.get("input") ?? "";
        const run = agent.send(input, { signal: req.signal });
        return { status: 200, stream: run.stream() };
      }

      return { status: 404, body: { error: "not_found" } };
    },
  };
}
