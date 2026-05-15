import type { AgentOptions, SystemPromptContext, SystemPromptResolver } from "../../types/agent.js";
import type { SendOptions } from "../../types/run.js";

/**
 * Resolve the effective system prompt for one `agent.send()` call.
 *
 * Priority (per ADR D4):
 *   1. `override` (from `SendOptions.systemPrompt`) — wins even when empty
 *      string (the user explicitly cleared the system context).
 *   2. `agent` as plain string — returned directly.
 *   3. `agent` as resolver function — awaited with `ctx`.
 *   4. Neither defined — returns `undefined`.
 *
 * Defensive coercion (per edge-case review EC-2): if the resolver returns
 * anything other than a string at runtime (null, a number, an object),
 * the function returns `undefined` instead of forwarding the bad value to
 * the LLM client.
 *
 * The SDK does NOT impose a timeout on the resolver. Errors thrown by the
 * resolver propagate to the caller of `agent.send()`.
 *
 * @internal
 */
export async function resolveSystemPrompt(
  agent: AgentOptions["systemPrompt"],
  override: SendOptions["systemPrompt"],
  ctx: SystemPromptContext,
): Promise<string | undefined> {
  if (override !== undefined) return override;
  if (agent === undefined) return undefined;
  if (typeof agent === "string") return agent;
  const resolver = agent satisfies SystemPromptResolver;
  const resolved = await resolver(ctx);
  return typeof resolved === "string" ? resolved : undefined;
}

/**
 * Cheap predicate used by `LocalAgent` and `CloudAgent` to skip building
 * the {@link SystemPromptContext} when neither agent-level nor per-call
 * prompt is configured. Avoids the lazy skills lookup in the hot path.
 *
 * @internal
 */
export function shouldResolveSystemPrompt(
  agent: AgentOptions["systemPrompt"],
  override: SendOptions["systemPrompt"],
): boolean {
  return agent !== undefined || override !== undefined;
}

/**
 * High-level helper used by both `LocalAgent.send` and `CloudAgent.send`.
 * Short-circuits when neither side configured a prompt, otherwise calls
 * `buildCtx` (which may be async — e.g. lazy skills lookup) and delegates
 * to {@link resolveSystemPrompt}.
 *
 * @internal
 */
export async function resolveSystemPromptForSend(
  agent: AgentOptions["systemPrompt"],
  override: SendOptions["systemPrompt"],
  buildCtx: () => Promise<SystemPromptContext>,
): Promise<string | undefined> {
  if (!shouldResolveSystemPrompt(agent, override)) return undefined;
  const ctx = await buildCtx();
  return resolveSystemPrompt(agent, override, ctx);
}
