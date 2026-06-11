/**
 * Express server adapter — mounts a TheoKit agent as Express middleware (T12.2).
 *
 * Optional peer dep: express@^4||^5
 *
 * @public
 */

import { createSharedAgentHandler } from "./shared-handler.js";
import type { AgentHandlerOptions, AgentLike } from "./types.js";

export function createAgentHandler(agent: AgentLike, opts?: AgentHandlerOptions) {
  return createSharedAgentHandler(agent, opts);
}
