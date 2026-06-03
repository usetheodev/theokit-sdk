/**
 * Public `Handoff` class — factory for handoff descriptors (Adoption
 * Roadmap #4; ADRs D214-D229).
 *
 * Usage:
 *
 *   import { Agent, Handoff } from "@theokit/sdk";
 *
 *   const billing = await Agent.create({
 *     name: "billing",
 *     systemPrompt: "You handle billing questions.",
 *     model: { id: "openai/gpt-4o-mini" },
 *     apiKey: process.env.OPENROUTER_API_KEY,
 *   });
 *
 *   const triage = await Agent.create({
 *     name: "triage",
 *     systemPrompt: "Classify the user's intent and transfer to the right specialist.",
 *     model: { id: "openai/gpt-4o-mini" },
 *     apiKey: process.env.OPENROUTER_API_KEY,
 *     handoffs: [
 *       billing,  // auto-wrapped as Handoff.create(billing)
 *       Handoff.create(supportAgent, { inputFilter: redactCreditCards }),
 *     ],
 *   });
 *
 * @public
 */

import type { ZodType } from "zod";

import type { SDKAgent } from "./types/agent.js";
import type { HandoffDescriptor, HandoffOptions } from "./types/handoff.js";

/** Recommended system-prompt prefix for senders (D215 / EC-13). */
export const RECOMMENDED_HANDOFF_PROMPT_PREFIX = `
You can transfer the conversation to other specialist agents when their
expertise matches the user's request. Invoke the appropriate
transfer_to_<agent> tool with a short reason. The receiving agent will
take over the conversation; do not duplicate their work.
`.trim();

export class Handoff {
  private constructor() {}

  /**
   * Build a `HandoffDescriptor` for a target agent. Wrap with custom options
   * (filter / inputType / callback / whitelist / etc); pass to
   * `Agent.create({ handoffs: [...] })`.
   *
   * Raw `SDKAgent` instances in `handoffs[]` are auto-wrapped by the runtime
   * — call `Handoff.create()` explicitly only when you need to customize.
   */
  static create<TInput extends ZodType = ZodType>(
    target: SDKAgent,
    options: HandoffOptions<TInput> = {} as HandoffOptions<TInput>,
  ): HandoffDescriptor<TInput> {
    if (target === undefined || target === null) {
      throw new Error("Handoff.create: target agent is required");
    }
    if (typeof target.send !== "function") {
      throw new Error("Handoff.create: target must be an SDKAgent instance");
    }
    const resolvedToolName = options.toolName ?? `transfer_to_${slugifyName(target)}`;
    return {
      target,
      options,
      resolvedToolName,
    };
  }
}

function slugifyName(agent: SDKAgent): string {
  const candidate = (agent as unknown as { name?: string }).name ?? agent.agentId ?? "anonymous";
  return (
    candidate
      .replace(/^agent-/i, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "anonymous"
  );
}

/**
 * Imperative escape hatch (D225). Useful for tests / programmatic flows
 * that need deterministic handoff without LLM routing.
 *
 * NOTE: this is a STANDALONE helper rather than a method on `SDKAgent`
 * to avoid invasive refactor of the agent class. Behavior is identical
 * to invoking the corresponding synthetic tool would be.
 */
export async function handoffTo(
  sender: SDKAgent,
  target: SDKAgent,
  message: string,
  options: HandoffOptions = {},
): Promise<string> {
  const descriptor = Handoff.create(target, options);
  // Lazy import to avoid loading internal module unless this is called.
  const { dispatchHandoff } = await import("./internal/handoff/dispatcher.js");
  const { createChainState } = await import("./internal/handoff/registry.js");
  const chainState = createChainState(sender.agentId, 5);
  const { reply } = await dispatchHandoff({
    descriptor,
    senderAgentId: sender.agentId,
    chainState,
    rawInputJson: undefined,
    history: { messages: [] },
    messageOverride: message,
  });
  return reply;
}

export {
  HandoffLoopError,
  HandoffNameCollisionError,
  HandoffPairLoopError,
  HandoffReceiverDisposedError,
  HandoffSelfReferenceError,
} from "./types/handoff.js";
