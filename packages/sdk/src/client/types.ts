/**
 * Client SDK types (T20.2, ADR D454).
 * @public
 * @deprecated since 2.x — types for the deprecated `@theokit/sdk/client`
 * (`TheoKitClient`) sub-path; removed with it in the next major.
 */

export interface ClientOptions {
  baseUrl: string;
  basePath?: string;
  headers?: Record<string, string>;
}

/**
 * Body of `POST <basePath>/send` as {@link TheoKitClient.send} resolves it.
 *
 * Deprecated with the sub-path, and worth reading as a loose envelope rather than
 * a contract: it does NOT describe what this package's own server adapters
 * produce. `createAgentHandler` answers with a `RunResult`
 * (`{ id, status, result?, model?, durationMs?, ... }`), so against that server
 * `output` and `error` are always `undefined` and the agent's text arrives under
 * a `result` key this interface does not declare.
 *
 * `status` is a bare `string` here; `RunResult.status` is the narrower
 * `"finished" | "error" | "cancelled"`.
 *
 * A non-2xx response never reaches this type — `send` throws instead, so `error`
 * is not where a transport failure shows up.
 */
export interface SendResponse {
  status: string;
  output?: unknown;
  error?: string;
}

/**
 * One decoded SSE frame from {@link TheoKitClient.stream}: the JSON body of a
 * `data:` line, with `type` promoted and every other key left open.
 *
 * Deprecated with the sub-path. `type`/`text` mirror the legacy server contract;
 * the events this SDK's own `Run.stream()` emits are `SDKMessage`s carrying their
 * own fields, which is why everything else is `unknown` and must be narrowed
 * before use.
 *
 * Trap: nothing validates the frame. A `data:` line that is not JSON is skipped
 * silently, and one that parses to any JSON value at all is cast to this type
 * unchecked — `event.type` can be `undefined` at runtime despite being declared
 * required.
 */
export interface StreamEvent {
  type: string;
  text?: string;
  [key: string]: unknown;
}
