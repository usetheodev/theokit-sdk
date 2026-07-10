/**
 * Subagent delegation — declarative child agent invocable as a tool.
 *
 * Per ADR D2: `defineSubAgent(spec)` returns a `CustomTool` that, when
 * invoked by the LLM, creates a child agent and sends the input as a
 * message. EC-2: delegation depth tracked to prevent infinite recursion.
 *
 * SE10 — the handler forwards the parent run's `AbortSignal` to the child.
 * SE11 — optional `onDelegationStart` / `onDelegationComplete` lifecycle hooks
 * let the caller reject, rewrite, observe, or annotate a delegation.
 *
 * @public
 */

import { z } from "zod";

import type { CustomTool, ToolContextMessage } from "../types/agent.js";

/** Arguments passed to {@link SubAgentSpec.messageFilter} (SE12). */
export interface MessageFilterArgs {
  /** The supervisor transcript (read-only text projection) available to this delegation. */
  messages: readonly ToolContextMessage[];
  /** The prompt about to be delegated (after any `onDelegationStart` rewrite). */
  input: string;
  /** The subagent's name. */
  name: string;
}

/** Context passed to {@link SubAgentSpec.onDelegationStart} before the child runs. */
export interface DelegationStartContext {
  input: string;
  name: string;
}

/**
 * Decision returned from {@link SubAgentSpec.onDelegationStart}. Discriminated on
 * `proceed` so a rejection (`proceed: false` + `rejectionReason`) and an approval
 * (`modifiedInput`) cannot be mixed into one nonsensical object.
 */
export type DelegationStartDecision =
  | { proceed: false; rejectionReason?: string }
  | {
      proceed?: true;
      modifiedInput?: string;
      /** SE13 — cap the child's iteration count (forwarded as `SendOptions.maxIterations`). */
      modifiedMaxSteps?: number;
    };

/** Context passed to {@link SubAgentSpec.onDelegationComplete} after the child settles. */
export interface DelegationCompleteContext {
  input: string;
  name: string;
  /** The child's text result (present on success). */
  result?: string;
  /** The error the child threw (present on failure); the error is still re-thrown. */
  error?: unknown;
}

/** Decision returned from {@link SubAgentSpec.onDelegationComplete}. */
export interface DelegationCompleteDecision {
  /** Appended to the child's result string. */
  feedback?: string;
}

export interface SubAgentSpec {
  name: string;
  description: string;
  instructions: string;
  model?: string;
  tools?: CustomTool[];
  maxDelegationDepth?: number;
  /**
   * SE11 — called before the supervisor delegates. Return `{ proceed: false }`
   * to reject (the child never runs and `rejectionReason` becomes the tool
   * result), or `{ modifiedInput }` to rewrite the delegated prompt. A throwing
   * hook surfaces (never silently swallowed).
   */
  onDelegationStart?: (
    ctx: DelegationStartContext,
  ) => DelegationStartDecision | undefined | Promise<DelegationStartDecision | undefined>;
  /**
   * SE11 — called after the delegation settles. On success `ctx.result` is set
   * and an optional `{ feedback }` is appended to it. On failure `ctx.error` is
   * set and the original error is ALWAYS re-thrown after this hook runs — a throw
   * from this hook on the error path is suppressed so it cannot mask the
   * delegation's real failure (on the success path a throw does propagate).
   */
  onDelegationComplete?: (
    ctx: DelegationCompleteContext,
  ) => DelegationCompleteDecision | undefined | Promise<DelegationCompleteDecision | undefined>;
  /**
   * SE12 — opt-in parent-context forwarding. When set, the supervisor transcript
   * (`ctx.messages`, a read-only text projection) is passed to this filter and the
   * returned subset is forwarded to the child as a role-tagged context preamble
   * prepended to the delegated input. When ABSENT the child runs input-only —
   * memory isolation stays the default. A filter returning `[]` forwards nothing.
   * A throwing filter propagates (fail-fast, never swallowed — same contract as
   * `onDelegationStart`); the delegation surfaces as a tool error.
   */
  messageFilter?: (args: MessageFilterArgs) => readonly ToolContextMessage[];
}

export class MaxDelegationDepthError extends Error {
  readonly code = "max_delegation_depth" as const;
  constructor(
    public readonly currentDepth: number,
    public readonly maxDepth: number,
  ) {
    super(`Max delegation depth ${maxDepth} exceeded (current: ${currentDepth})`);
    this.name = "MaxDelegationDepthError";
  }
}

/**
 * Run the `onDelegationStart` hook; returns either a rejection or the (possibly
 * rewritten) input plus the optional SE13 `maxSteps` cap.
 */
async function applyDelegationStart(
  spec: SubAgentSpec,
  input: string,
): Promise<{ reject: string } | { input: string; maxSteps?: number }> {
  if (spec.onDelegationStart === undefined) return { input };
  const decision = await spec.onDelegationStart({ input, name: spec.name });
  if (decision === undefined) return { input };
  if (decision.proceed === false)
    return { reject: decision.rejectionReason ?? "(delegation rejected)" };
  return {
    input: decision.modifiedInput ?? input,
    ...(decision.modifiedMaxSteps !== undefined ? { maxSteps: decision.modifiedMaxSteps } : {}),
  };
}

/**
 * Create the transient child agent and send the input, composing every forwarded
 * `SendOptions` onto ONE `send` call — SE10 `signal` + SE13 `maxIterations`. Absent
 * every option ⇒ the pre-SE10 single-arg `send(input)` shape. Dispose in `finally`.
 */
async function runChildAgent(
  spec: SubAgentSpec,
  input: string,
  signal: AbortSignal | undefined,
  maxSteps: number | undefined,
): Promise<string> {
  // Lazy import to avoid circular dependency.
  const { Agent } = await import("../agent.js");
  const agent = await Agent.create({
    ...(spec.model ? { model: { id: spec.model } } : {}),
    systemPrompt: spec.instructions,
    tools: spec.tools ?? [],
  });
  try {
    const sendOptions: { signal?: AbortSignal; maxIterations?: number } = {
      ...(signal !== undefined ? { signal } : {}),
      ...(maxSteps !== undefined ? { maxIterations: maxSteps } : {}),
    };
    const run =
      Object.keys(sendOptions).length > 0
        ? await agent.send(input, sendOptions)
        : await agent.send(input);
    const result = await run.wait();
    return result.result ?? "(no response)";
  } finally {
    agent.dispose();
  }
}

/**
 * Best-effort error-path notification: run `onDelegationComplete` with the child's
 * error so the caller can observe the failure. The observer's own throw (sync or
 * async) is suppressed here so it cannot mask the delegation's real error, which the
 * handler re-throws next.
 */
async function notifyDelegationError(
  spec: SubAgentSpec,
  input: string,
  error: unknown,
): Promise<void> {
  if (spec.onDelegationComplete === undefined) return;
  try {
    await spec.onDelegationComplete({ input, name: spec.name, error });
  } catch {
    // Subordinate to `error`; the child's real cause wins.
  }
}

/**
 * SE12 — apply `messageFilter` (if set) and prepend the filtered supervisor
 * transcript to the delegated input as a role-tagged context preamble. Absent
 * filter OR no messages OR an empty filtered subset ⇒ the original input
 * (isolation-by-default preserved).
 */
function applyMessageFilter(
  spec: SubAgentSpec,
  input: string,
  messages: readonly ToolContextMessage[] | undefined,
): string {
  if (spec.messageFilter === undefined || messages === undefined) return input;
  const filtered = spec.messageFilter({ messages, input, name: spec.name });
  if (filtered.length === 0) return input;
  const preamble = filtered.map((m) => `${m.role}: ${m.content}`).join("\n");
  return `Prior conversation:\n${preamble}\n\nTask:\n${input}`;
}

/** Run the success-path `onDelegationComplete` hook; appends its `feedback` to the result. */
async function applyDelegationComplete(
  spec: SubAgentSpec,
  input: string,
  result: string,
): Promise<string> {
  if (spec.onDelegationComplete === undefined) return result;
  const completion = await spec.onDelegationComplete({ input, name: spec.name, result });
  return completion?.feedback !== undefined ? result + completion.feedback : result;
}

export function defineSubAgent(spec: SubAgentSpec, _parentDepth = 0): CustomTool {
  const currentDepth = _parentDepth + 1;
  const maxDepth = spec.maxDelegationDepth ?? 3;

  if (currentDepth > maxDepth) {
    throw new MaxDelegationDepthError(currentDepth, maxDepth);
  }

  const inputSchema = z.object({
    input: z.string().describe("Task for the subagent"),
  });

  return {
    name: spec.name,
    description: spec.description,
    inputSchema: inputSchema as unknown as Record<string, unknown>,
    handler: async (
      rawInput: Record<string, unknown>,
      ctx?: {
        signal?: AbortSignal;
        context?: unknown;
        messages?: readonly ToolContextMessage[];
      },
    ): Promise<string> => {
      const { input: parsed } = inputSchema.parse(rawInput);

      const start = await applyDelegationStart(spec, parsed);
      if ("reject" in start) return start.reject;
      // SE12 — opt-in: forward the filtered supervisor transcript as a preamble.
      const input = applyMessageFilter(spec, start.input, ctx?.messages);

      let result: string;
      try {
        // SE13 — apply the optional onDelegationStart maxSteps cap on the child send.
        result = await runChildAgent(spec, input, ctx?.signal, start.maxSteps);
      } catch (error) {
        // SE11 — notify the completion hook of the failure (best-effort observer),
        // then re-throw the ORIGINAL error (Rule 8: never swallow the delegation's
        // own failure).
        await notifyDelegationError(spec, input, error);
        throw error;
      }
      return applyDelegationComplete(spec, input, result);
    },
  };
}
