import { Inject } from "@theokit/di";

import { AGENT_TOKEN } from "./tokens.js";

/**
 * Parameter decorator — injects the REQUEST-scoped Agent into a constructor.
 * Equivalent to `@Inject(AGENT_TOKEN)` but documents intent.
 *
 * @example
 *   @Injectable()
 *   class ChatController {
 *     constructor(@InjectAgent() private readonly agent: Agent) {}
 *
 *     async chat(message: string) {
 *       return this.agent.send(message);
 *     }
 *   }
 */
export function InjectAgent(): ParameterDecorator {
  return Inject(AGENT_TOKEN);
}
