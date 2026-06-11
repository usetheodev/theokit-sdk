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
