/**
 * Server adapter barrel — exports all framework adapters (T12.2).
 * @public
 */

export { createAgentHandler as createExpressAgentHandler } from "./express.js";
export { createAgentHandler as createFastifyAgentHandler } from "./fastify.js";
export { createAgentHandler as createHonoAgentHandler } from "./hono.js";
export type { AgentHandlerOptions, AgentLike } from "./types.js";
