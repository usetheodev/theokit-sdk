/**
 * Public `Handoff` class — factory for handoff descriptors (Adoption
 * Roadmap #4; ADRs D214-D229).
 *
 * Usage:
 *
 *   import { Agent } from "@theokit/sdk";
 *   import { Handoff } from "@theokit/sdk-handoff";
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

/**
 * Prose to prepend to a SENDING agent's `systemPrompt` so the model knows the `transfer_to_*` tools
 * exist and what they mean.
 *
 * ```ts
 * systemPrompt: `${RECOMMENDED_HANDOFF_PROMPT_PREFIX}\n\nYou triage support requests.`
 * ```
 *
 * Nothing applies it for you — neither {@link Handoff.create} nor {@link Handoff.asPlugin} touches
 * the system prompt, so omitting it is legal and usually shows up as a model that never transfers.
 * Only the sender needs it; the receiver is unaware it was handed a conversation.
 *
 * @public
 */
export const RECOMMENDED_HANDOFF_PROMPT_PREFIX = `
You can transfer the conversation to other specialist agents when their
expertise matches the user's request. Invoke the appropriate
transfer_to_<agent> tool with a short reason. The receiving agent will
take over the conversation; do not duplicate their work.
`.trim();

/**
 * Peer-to-peer delegation: one agent hands the conversation to another and stops.
 *
 * A handoff is not a subagent call. A subagent runs, returns a result, and the parent continues; a
 * handoff TRANSFERS the turn — the target answers the user directly and the source does not resume.
 * Reach for it when the right responder is a different agent (billing, escalation, a specialist),
 * and for a tool-shaped "go find this out and come back", use `agents` / `Tool.create` instead.
 *
 * Two entry points, and they are not interchangeable:
 *
 * - {@link Handoff.create} builds one descriptor, for `Agent.create({ handoffs: [...] })`. A bare
 *   `SDKAgent` in that array is auto-wrapped, so call this explicitly only to customise (input
 *   schema, filter, callback).
 * - {@link Handoff.asPlugin} installs a whole set as a plugin, which is the SDK 2.x+ shape and what
 *   the README's migration section points at.
 *
 * A namespace class: `new Handoff()` is a compile error, matching `Agent.create` / `Tool.create`.
 */
export class Handoff {
  private constructor() {}

  /**
   * Describe one handoff target. Pass the result inside `Handoff.asPlugin({ targets })` or
   * `Agent.create({ handoffs })`.
   *
   * ```ts
   * Handoff.create(billing, { toolName: "escalate_billing" })
   * ```
   *
   * A bare `SDKAgent` in either array is auto-wrapped with empty options, so call this explicitly
   * only to customise — see {@link HandoffOptions}, and note that `tools` there is currently
   * ignored.
   *
   * The tool the model sees is named `transfer_to_<slug>`, where the slug comes from the target's
   * `name` (falling back to its `agentId`, then to `"anonymous"`) with a leading `agent-` stripped,
   * every run of characters OUTSIDE `[A-Za-z0-9_-]` folded to a single `_`, leading and trailing
   * `_` trimmed, and a 64-char truncation. Hyphens and underscores are preserved, so `"billing EU"`
   * and `"billing (EU)"` both become `billing_EU` while `"billing-EU"` stays distinct. Two targets
   * whose names collapse to the same slug are NOT caught here — the collision is raised later, when
   * the set is normalised.
   *
   * Throws `ConfigurationError` with `code: "handoff_target_required"` for a null/undefined target,
   * and `code: "handoff_target_invalid"` for anything without a `send` method. It validates the
   * target only, never the options.
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
   * Expose each target as a `transfer_to_<receiver>` tool on the host agent — the SDK 2.x way to
   * wire handoffs.
   *
   * ```ts
   * const support = await Agent.create({
   *   name: "support",
   *   systemPrompt: `${RECOMMENDED_HANDOFF_PROMPT_PREFIX}\n\nYou answer support requests.`,
   *   plugins: [Handoff.asPlugin({ parentAgentId: "support", targets: [billing] })],
   * });
   * ```
   *
   * Pass `parentAgentId` — it defaults to `"anonymous"`, and it is what self-reference detection
   * and the chain trace compare against, so leaving it out weakens both. `maxHandoffDepth` defaults
   * to 5.
   *
   * Four behaviours that are easy to be surprised by:
   *
   * - **`maxHandoffDepth: 0`, or an empty `targets`, registers NOTHING** and returns a plugin that
   *   silently does nothing. There is no error and no warning; the model simply never sees a
   *   transfer tool.
   * - **Registration is ASYNCHRONOUS.** `register()` starts an unawaited dynamic import and
   *   returns, so the tools appear a microtask later. Nothing here reports a failure in that
   *   import, and nothing lets you await readiness.
   * - **The receiver does NOT get the user's message.** History replay is unimplemented: the tool
   *   handler dispatches with an empty transcript, so the receiving agent is sent the literal
   *   string `` `(Handoff from <sender> — no prior user message in history.)` `` and must answer
   *   from that alone. Anything the target needs to know has to be in its own system prompt, or
   *   you drive the handoff yourself with {@link handoffTo}, which passes the message through.
   * - **The handoff tool never throws at the caller.** Every failure — loop detected, depth
   *   exceeded, disposed receiver, `isEnabled` false, input that fails `inputType` — is caught
   *   inside the tool handler and returned to the MODEL as
   *   `{"ok":false,"error":"<ErrorName>","message":"…"}`. The exported error classes are real, but
   *   in this wiring they never reach your `try`/`catch`; watch the tool results instead.
   *
   * A self-referencing target and two targets resolving to the same tool name are both rejected —
   * but inside that async registration, so they arrive as an UNHANDLED PROMISE REJECTION
   * (`HandoffSelfReferenceError` / `HandoffNameCollisionError`) rather than as a throw you can
   * catch around `Agent.create`. Validate the target list yourself if you need to handle them.
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
 * Options for {@link Handoff.asPlugin}.
 *
 * @public
 */
export interface AsPluginOptions {
  /**
   * Agents this one may transfer to. A bare `SDKAgent` is auto-wrapped; use
   * {@link Handoff.create} for a customised entry.
   *
   * An EMPTY array registers no tools at all and produces a plugin that does nothing — silently.
   */
  readonly targets: ReadonlyArray<SDKAgent | HandoffDescriptor>;
  /**
   * Identity of the HOST agent, as it will appear in the chain trace. Default `"anonymous"`.
   *
   * Self-reference detection compares `target.agentId` against this exact string, so a default
   * `"anonymous"` means an agent listing itself among `targets` is NOT caught, and the pair-loop
   * guard is the only thing left between you and a recursion.
   */
  readonly parentAgentId?: string;
  /**
   * Maximum hops in one chain before `HandoffLoopError`. Default 5. `0` disables handoffs entirely
   * rather than allowing zero hops.
   *
   * The counter is created FRESH for each tool invocation, so it bounds one dispatch, not the whole
   * `send()` — cross-tool depth accumulation is not implemented. In practice a single invocation
   * makes one hop, so this rarely fires; the pair guard (same sender → same receiver twice) is what
   * actually catches ping-pong.
   */
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
 * Hand `message` to `target` right now and return its reply text — no LLM routing, no tool call.
 *
 * ```ts
 * const reply = await handoffTo(triage, billing, "refund for order 42");
 * ```
 *
 * Use it for tests and for flows where YOU decide the destination. Unlike the plugin wiring, this
 * passes the message through verbatim, so the receiver actually sees what the user said.
 *
 * It THROWS, where the tool-based path swallows: a disposed receiver raises
 * `HandoffReceiverDisposedError`, `isEnabled: false` raises a plain `Error`, and an
 * `inputType` that rejects raises a plain `Error` wrapping the Zod message. Depth is fixed at 5 and
 * the chain state is fresh per call, so `HandoffLoopError` is unreachable here and only the
 * same-pair guard can fire — within a single call, never across calls.
 *
 * A receiver that does not finish cleanly does not throw either: you get the sentinel string
 * `` `(Handoff target <id> returned status=<status>)` `` as the reply. Check for it if the
 * distinction matters.
 *
 * Standalone rather than a method on `SDKAgent` so the agent class need not know about handoffs.
 *
 * @public
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
