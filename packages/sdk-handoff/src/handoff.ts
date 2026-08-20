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

import { ConfigurationError, Plugin, type PluginContext, type SDKAgent } from "@theokit/sdk";
import type { ZodType } from "zod";
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
      // B-135: typed rather than bare, because `Handoff.create` is `@public` and a caller could
      // otherwise only distinguish these two refusals by matching the message string — which is not
      // a contract. Additive, not breaking: `ConfigurationError extends TheokitAgentError extends
      // Error`, and the messages are unchanged.
      throw new ConfigurationError("Handoff.create: target agent is required", {
        code: "handoff_target_required",
      });
    }
    if (typeof target.send !== "function") {
      throw new ConfigurationError("Handoff.create: target must be an SDKAgent instance", {
        code: "handoff_target_invalid",
      });
    }
    const resolvedToolName = options.toolName ?? `transfer_to_${slugifyName(target)}`;
    return {
      target,
      options,
      resolvedToolName,
    };
  }

  /**
   * Plugin-based wiring (SDK 2.x preferred). Wraps `targets` in synthetic
   * `transfer_to_<receiver>` tools and registers them via `ctx.registerTool`
   * at agent init time.
   *
   * Replaces the legacy `Agent.create({ handoffs: [...] })` option (which is
   * still supported as a transitional convenience while sdk-handoff is
   * installed — the framework lazy-imports the tool-injector at runtime).
   *
   * @example
   *   const support = await Agent.create({
   *     name: "support",
   *     plugins: [Handoff.asPlugin({ parentAgentId: "support", targets: [billing] })],
   *   });
   */
  static asPlugin(opts: AsPluginOptions): Plugin {
    const parent = opts.parentAgentId ?? "anonymous";
    const maxDepth = opts.maxHandoffDepth ?? 5;
    const targets = opts.targets;
    return Plugin.create({
      name: `handoff-${parent}`,
      version: "1.0.0",
      kind: "general" as const,
      register(ctx: PluginContext): void {
        if (maxDepth === 0 || targets.length === 0) return;
        // Lazy import — keeps cold path lean if asPlugin is constructed but
        // its register hook is never invoked (e.g., disabled by config).
        void (async () => {
          const { normalizeHandoffs, buildHandoffTool } = await import(
            "./internal/tool-injector.js"
          );
          const normalized = normalizeHandoffs(parent, targets);
          for (const { descriptor } of normalized) {
            ctx.registerTool(buildHandoffTool(parent, descriptor, maxDepth));
          }
        })();
      },
    });
  }
}

/**
 * Options for `Handoff.asPlugin()`. `parentAgentId` defaults to `"anonymous"`;
 * pass the host agent's `name` for correct loop detection in chains.
 */
export interface AsPluginOptions {
  readonly targets: ReadonlyArray<SDKAgent | HandoffDescriptor>;
  readonly parentAgentId?: string;
  readonly maxHandoffDepth?: number;
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
  const { dispatchHandoff } = await import("./internal/dispatcher.js");
  const { createChainState } = await import("./internal/registry.js");
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
