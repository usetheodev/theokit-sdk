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

import type { AgentDefinition, CustomTool, ToolContextMessage } from "../types/agent.js";
import type { ModelSelection } from "../types/agent-prims.js";
import type { Run } from "../types/run.js";

/**
 * Credentials a parent agent hands down to its subagent tools so the child
 * inherits the parent's auth (and, absent an explicit `spec.model`, its model).
 * @internal
 */
export interface InheritedCredentials {
  readonly apiKey?: string;
  readonly model?: ModelSelection;
}

/**
 * Private per-tool setter installed on subagent tools. Kept off the public
 * `CustomTool` shape (and off every tool handler's `ctx`) so the parent's API
 * key never reaches third-party tool code — only the SDK's own delegation path.
 */
const INHERIT_CREDENTIALS = Symbol("theokit.subagent.inheritCredentials");

type CredentialSink = (creds: InheritedCredentials) => void;

/**
 * Called by the local runtime for every tool in a run: if the tool is a
 * subagent, its child agent inherits the parent's `apiKey`/`model`. A no-op for
 * any other tool (third-party tools never receive the parent's credentials).
 * @internal
 */
export function inheritSubAgentCredentials(tool: CustomTool, creds: InheritedCredentials): void {
  const sink = (tool as { [INHERIT_CREDENTIALS]?: CredentialSink })[INHERIT_CREDENTIALS];
  if (typeof sink === "function") sink(creds);
}

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
  /**
   * SE15 — 1-based count of times THIS subagent tool has been invoked (a
   * per-`defineSubAgent`-instance counter). Incremented before this hook runs;
   * a rejected delegation still counts. Enables reject-after-N patterns.
   */
  iteration: number;
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
  /** SE15 — the same 1-based iteration this delegation's `onDelegationStart` saw. */
  iteration: number;
}

/**
 * The return of a delegation hook: a decision, a promise of one, or nothing —
 * `void` lets a side-effect-only callback (`(ctx) => { log(ctx) }`) type-check,
 * which is the common case (mirrors Mastra's `async ctx => { ... }` hooks).
 */
// biome-ignore lint/suspicious/noConfusingVoidType: `void` is the idiomatic return for an optional-return callback; the rule false-positives on callback return unions.
type DelegationHookResult<T> = T | void | Promise<T | void>;

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
  ) => DelegationHookResult<DelegationStartDecision>;
  /**
   * SE11 — called after the delegation settles. On success `ctx.result` is set
   * and an optional `{ feedback }` is appended to it. On failure `ctx.error` is
   * set and the original error is ALWAYS re-thrown after this hook runs — a throw
   * from this hook on the error path is suppressed so it cannot mask the
   * delegation's real failure (on the success path a throw does propagate).
   */
  onDelegationComplete?: (
    ctx: DelegationCompleteContext,
  ) => DelegationHookResult<DelegationCompleteDecision>;
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
  /**
   * SE14 — opt-in subagent result-context control. When `true`, the child's
   * completed tool-call results (name + result) are appended to the delegation
   * payload returned to the supervisor, inside a `<subagent-tool-results>` block.
   * When absent/`false` the delegation returns the child's final text only —
   * text-only stays the default (Mastra's scoped posture). See ADR 0006.
   */
  includeToolResults?: boolean;
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
  iteration: number,
): Promise<{ reject: string } | { input: string; maxSteps?: number }> {
  if (spec.onDelegationStart === undefined) return { input };
  const decision = await spec.onDelegationStart({ input, name: spec.name, iteration });
  if (decision === undefined) return { input };
  if (decision.proceed === false)
    return { reject: decision.rejectionReason ?? "(delegation rejected)" };
  return {
    input: decision.modifiedInput ?? input,
    ...(decision.modifiedMaxSteps !== undefined ? { maxSteps: decision.modifiedMaxSteps } : {}),
  };
}

/**
 * SE14 — replay the child run's stream (a safe post-`wait()` idiom — the run buffers
 * events, `stream()` replays them) and collect every completed tool-call result into
 * a delimited block. Returns `""` when the child ran no completed tool calls. See ADR 0006.
 */
async function collectChildToolResults(run: Run): Promise<string> {
  const lines: string[] = [];
  for await (const event of run.stream()) {
    if (event.type === "tool_call" && event.status === "completed") {
      const rendered =
        typeof event.result === "string" ? event.result : JSON.stringify(event.result ?? null);
      lines.push(`${event.name}: ${rendered}`);
    }
  }
  if (lines.length === 0) return "";
  return `\n\n<subagent-tool-results>\n${lines.join("\n")}\n</subagent-tool-results>`;
}

/**
 * Create the transient child agent and send the input, composing every forwarded
 * `SendOptions` onto ONE `send` call — SE10 `signal` + SE13 `maxIterations`. Absent
 * every option ⇒ the pre-SE10 single-arg `send(input)` shape. SE14 — when
 * `includeToolResults` is set, append the child's completed tool results. Dispose in `finally`.
 */
async function runChildAgent(
  spec: SubAgentSpec,
  input: string,
  signal: AbortSignal | undefined,
  maxSteps: number | undefined,
  inherited: InheritedCredentials | undefined,
): Promise<string> {
  // Lazy import to avoid circular dependency.
  const { Agent } = await import("../agent.js");
  // The child inherits the parent's apiKey (else Agent.create throws
  // "Missing API key"), and its model unless the spec overrides it.
  const model: string | ModelSelection | undefined = spec.model
    ? { id: spec.model }
    : inherited?.model;
  const agent = await Agent.create({
    ...(inherited?.apiKey !== undefined ? { apiKey: inherited.apiKey } : {}),
    ...(model !== undefined ? { model } : {}),
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
    const text = result.result ?? "(no response)";
    // SE14 — text-only by default; opt-in appends the child's tool results.
    return spec.includeToolResults === true ? text + (await collectChildToolResults(run)) : text;
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
  iteration: number,
): Promise<void> {
  if (spec.onDelegationComplete === undefined) return;
  try {
    await spec.onDelegationComplete({ input, name: spec.name, error, iteration });
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
  iteration: number,
): Promise<string> {
  if (spec.onDelegationComplete === undefined) return result;
  const completion = await spec.onDelegationComplete({ input, name: spec.name, result, iteration });
  return completion?.feedback !== undefined ? result + completion.feedback : result;
}

function defineSubAgent(spec: SubAgentSpec, _parentDepth = 0): CustomTool {
  const currentDepth = _parentDepth + 1;
  const maxDepth = spec.maxDelegationDepth ?? 3;

  if (currentDepth > maxDepth) {
    throw new MaxDelegationDepthError(currentDepth, maxDepth);
  }

  // Zod for RUNTIME validation of the tool_use input …
  const inputZod = z.object({
    input: z.string().describe("Task for the subagent"),
  });
  // … and a real Draft-7 JSON Schema for the LLM. `CustomTool.inputSchema` is sent
  // to the model verbatim; a raw Zod object would serialize to garbage, so the
  // model emits malformed input that fails `inputZod.parse` and the delegation
  // never runs (the previous bug — the schema and the validator are now distinct).
  const inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      input: { type: "string", description: "Task for the subagent" },
    },
    required: ["input"],
    additionalProperties: false,
  };

  // SE15 — per-instance delegation counter, surfaced as `iteration` on the hook
  // contexts. Incremented once per handler invocation before onDelegationStart.
  let iteration = 0;

  // Credentials handed down by the parent runtime (see `inheritSubAgentCredentials`).
  let inherited: InheritedCredentials | undefined;

  const tool: CustomTool = {
    name: spec.name,
    description: spec.description,
    inputSchema,
    handler: async (
      rawInput: Record<string, unknown>,
      ctx?: {
        signal?: AbortSignal;
        context?: unknown;
        messages?: readonly ToolContextMessage[];
      },
    ): Promise<string> => {
      const { input: parsed } = inputZod.parse(rawInput);
      iteration += 1; // SE15 — before onDelegationStart; a rejected delegation still counts.
      // Pin THIS invocation's iteration before any await so a concurrent invocation
      // bumping the shared counter cannot change the value onDelegationComplete /
      // notifyDelegationError observe — they see the same iteration onDelegationStart did.
      const capturedIteration = iteration;

      const start = await applyDelegationStart(spec, parsed, capturedIteration);
      if ("reject" in start) return start.reject;
      // SE12 — opt-in: forward the filtered supervisor transcript as a preamble.
      const input = applyMessageFilter(spec, start.input, ctx?.messages);

      let result: string;
      try {
        // SE13 — apply the optional onDelegationStart maxSteps cap on the child send.
        result = await runChildAgent(spec, input, ctx?.signal, start.maxSteps, inherited);
      } catch (error) {
        // SE11 — notify the completion hook of the failure (best-effort observer),
        // then re-throw the ORIGINAL error (Rule 8: never swallow the delegation's
        // own failure).
        await notifyDelegationError(spec, input, error, capturedIteration);
        throw error;
      }
      return applyDelegationComplete(spec, input, result, capturedIteration);
    },
  };

  // Install the private credential sink (off the public shape + off every ctx).
  Object.defineProperty(tool, INHERIT_CREDENTIALS, {
    value: ((creds: InheritedCredentials) => {
      inherited = creds;
    }) satisfies CredentialSink,
    enumerable: false,
  });

  return tool;
}

/** SE36 — `SubAgent.create` replaces `defineSubAgent` (ADR 0015). @public */
export class SubAgent {
  private constructor() {}
  static create(spec: SubAgentSpec, parentDepth = 0): CustomTool {
    return defineSubAgent(spec, parentDepth);
  }
}

/**
 * Convert a parent's declarative `agents` map ({@link AgentDefinition} per key)
 * into delegation tools for the LOCAL runtime — the counterpart of the
 * cloud/fixture subagent wiring. Each child inherits the parent's `apiKey`/model
 * via {@link inheritSubAgentCredentials}; `def.model` overrides the model
 * (`"inherit"` keeps the parent's), and `def.tools` scopes the child to that
 * subset of the parent's tools (absent → the parent's full toolset, per the
 * `AgentDefinition.tools` contract).
 *
 * Per-subagent `mcpServers` on an `AgentDefinition` is honored by the cloud
 * runtime only; it is not wired into local delegation here.
 *
 * @internal
 */
export function subAgentToolsFromDefinitions(
  agents: Record<string, AgentDefinition>,
  parentTools: readonly CustomTool[],
): CustomTool[] {
  return Object.entries(agents).map(([name, def]) => {
    const whitelist =
      Array.isArray(def.tools) && def.tools.length > 0 ? new Set(def.tools) : undefined;
    const childTools = whitelist ? parentTools.filter((t) => whitelist.has(t.name)) : parentTools;
    return defineSubAgent({
      name,
      description: def.description,
      instructions: def.prompt,
      ...(def.model !== undefined && def.model !== "inherit" ? { model: def.model.id } : {}),
      tools: [...childTools],
    });
  });
}
