/**
 * Client sub-path barrel (T20.2, ADR D454).
 * Exported via `@theokit/sdk/client`.
 * @public
 * @deprecated since 2.x — the `@theokit/sdk/client` sub-path consumes a legacy
 * server-adapter HTTP contract (`/agent/send`, `/agent/stream`) that the
 * ecosystem no longer produces. Use the `Agent` façade (`@theokit/sdk`) for
 * in-process runs, or the framework's `POST /api/agents/<name>` typed client for
 * HTTP. This sub-path will be removed in the next major.
 */

export { TheoKitClient } from "./theokit-client.js";
export type { ClientOptions, SendResponse, StreamEvent } from "./types.js";
