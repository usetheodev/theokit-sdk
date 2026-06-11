/**
 * AgentMiddleware — shared contract for server adapters (T12.2).
 * @public
 */

export interface AgentHandlerOptions {
  basePath?: string;
  onError?: (err: Error) => void;
}

export interface AgentLike {
  send(
    input: string,
    opts?: { signal?: AbortSignal },
  ): { stream(): AsyncIterable<unknown>; wait(): Promise<unknown> };
  dispose(): void;
}

export interface AgentHandler {
  routes: ReadonlyArray<{ method: string; path: string }>;
  handleRequest(req: {
    method: string;
    url: string;
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<{ status: number; body?: unknown; stream?: AsyncIterable<unknown> }>;
}
