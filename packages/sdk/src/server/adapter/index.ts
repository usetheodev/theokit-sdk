/**
 * Framework-neutral agent handler.
 *
 * `createAgentHandler` returns an {@link AgentHandler}: a route DESCRIPTOR — a list of
 * `{ method, path }` pairs plus a `handleRequest(req)` that takes a plain request shape and returns
 * a plain `{ status, body?, stream? }`. It is not middleware for any framework, and it imports none:
 * the host binds the descriptor to its own router.
 *
 * This replaces `express.ts`, `fastify.ts` and `hono.ts`, which were byte-identical below their
 * docblocks — two imports and a one-line delegation each, with no framework type imported,
 * referenced or adapted anywhere. Three aliases for one function is a cost per framework the SDK
 * wants to name; worse, each docblock claimed an adaptation that did not happen ("mounts a TheoKit
 * agent as Express middleware"), so a reader following the documentation would have looked for a
 * `(req, res, next)` they were never given.
 *
 * If per-framework entry points are wanted later, the honest form is one that actually adapts —
 * returning an Express middleware, a Fastify plugin, a Hono handler. That is a real feature with
 * real peer dependencies, not a rename.
 *
 * @public
 */

export { createSharedAgentHandler as createAgentHandler } from "./shared-handler.js";
export type { AgentHandler, AgentHandlerOptions, AgentLike } from "./types.js";
