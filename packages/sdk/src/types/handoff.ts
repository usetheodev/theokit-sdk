/**
 * Public types for `Agent.create({ handoffs })` + `Handoff.create()` +
 * `Agent.handoffTo()` (Adoption Roadmap #4; ADRs D214-D229).
 *
 * Pattern: handoff-as-tool. Each handoff destination becomes a synthetic
 * `transfer_to_<receiver>` function tool exposed to the LLM. Runtime
 * intercepts the tool call and routes the next turn to the receiver.
 *
 * @public
 */

import type { ZodType } from "zod";

import type { SDKAgent } from "./agent.js";

/**
 * Context handed to `onHandoff` callbacks and `isEnabled` predicates.
 * Read-only snapshot of the handoff dispatch state.
 */
export interface HandoffContext {
  readonly senderAgentId: string;
  readonly receiverAgentId: string;
  /** Depth counter AT dispatch time (post-increment; first handoff = 1). */
  readonly currentDepth: number;
  /** Chain of agentIds traversed so far in this send(). Always ends with sender. */
  readonly chain: ReadonlyArray<string>;
}

/**
 * The transcript wrapper passed to `inputFilter`. `messages` is widened to
 * `unknown[]` so this type doesn't import from `messages.ts` (avoids cycle
 * — implementations cast to `SDKMessage[]` internally).
 */
export interface HandoffHistory {
  readonly messages: ReadonlyArray<unknown>;
}

/**
 * Options accepted by `Handoff.create(target, opts?)`.
 *
 * @public
 */
export interface HandoffOptions<TInput extends ZodType = ZodType> {
  /** Override the default tool name `transfer_to_<receiver.name>` (D215). */
  readonly toolName?: string;
  /** Override the default tool description. */
  readonly toolDescription?: string;
  /**
   * Side-effect callback fired BEFORE the receiver takes over.
   *
   * **Semantics (D227):** throwing aborts the handoff — the synthetic tool
   * returns `tool_error: onHandoff_failed: <message>` so the LLM sees the
   * conflict. Logger-style consumers MUST wrap their own try/catch to
   * swallow exceptions.
   */
  readonly onHandoff?: (
    ctx: HandoffContext,
    parsed: TInput extends ZodType ? unknown : undefined,
  ) => void | Promise<void>;
  /**
   * Zod schema for the handoff tool-call arguments (structured payload).
   * When set, LLM-provided args are validated before `onHandoff` fires.
   *
   * **Edge case (D229):** empty/null `inputJson` parses as `{}` before
   * Zod refinements fire — required-field schemas still throw normally.
   */
  readonly inputType?: TInput;
  /**
   * Filter the history passed to the receiver (D216 default = full; D219).
   *
   * **Resilience (D228):** if this callback throws, the runtime logs once
   * to stderr and falls back to the un-filtered history. Use this for
   * privacy redaction; if you need fatal-on-failure semantics, throw in
   * `onHandoff` instead.
   */
  readonly inputFilter?: (history: HandoffHistory) => HandoffHistory | Promise<HandoffHistory>;
  /**
   * Restrict the receiver's tools for the post-handoff turn ONLY (D224).
   * Subsequent receiver-internal turns use the receiver's full tool set.
   */
  readonly tools?: ReadonlyArray<string>;
  /**
   * Dynamically enable/disable this handoff. Bool = static; predicate =
   * called per-`Agent.send()` to evaluate.
   */
  readonly isEnabled?: boolean | ((ctx: HandoffContext) => boolean | Promise<boolean>);
}

/**
 * Result of a single handoff dispatch (for telemetry / observability).
 *
 * @public
 */
export interface HandoffResult {
  readonly from: string;
  readonly to: string;
  readonly depth: number;
  readonly toolName: string;
  readonly reasonFromLlm?: string;
}

/** Throw when handoff depth exceeds `maxHandoffDepth` (default 5; D218). */
export class HandoffLoopError extends Error {
  override readonly name = "HandoffLoopError";
  readonly depth: number;
  readonly chain: ReadonlyArray<string>;
  constructor(depth: number, chain: ReadonlyArray<string>) {
    super(
      `Handoff loop exceeded max depth ${depth}. Chain: ${chain.join(" -> ")}. ` +
        `Use Agent.create({ maxHandoffDepth: N }) to raise the cap.`,
    );
    this.depth = depth;
    this.chain = chain;
  }
}

/** Throw when the same (sender, receiver) pair invoked twice in one send() (D221). */
export class HandoffPairLoopError extends Error {
  override readonly name = "HandoffPairLoopError";
  readonly senderAgentId: string;
  readonly receiverAgentId: string;
  constructor(senderAgentId: string, receiverAgentId: string) {
    super(
      `Handoff loop: ${senderAgentId} -> ${receiverAgentId} already invoked in this send() call. ` +
        `Likely a ping-pong loop; revisit your handoff conditions.`,
    );
    this.senderAgentId = senderAgentId;
    this.receiverAgentId = receiverAgentId;
  }
}

/** Throw when an agent's `handoffs[]` includes a self-reference (EC-6). */
export class HandoffSelfReferenceError extends Error {
  override readonly name = "HandoffSelfReferenceError";
  readonly agentId: string;
  constructor(agentId: string) {
    super(
      `Agent "${agentId}" has a self-reference in its handoffs[]. ` +
        `Self-handoff causes infinite recursion; introduce a sibling agent for re-entry.`,
    );
    this.agentId = agentId;
  }
}

/** Throw when receiver is disposed at dispatch time (EC-5). */
export class HandoffReceiverDisposedError extends Error {
  override readonly name = "HandoffReceiverDisposedError";
  readonly receiverAgentId: string;
  constructor(receiverAgentId: string) {
    super(
      `Handoff target agent "${receiverAgentId}" is disposed. ` +
        `Don't dispose receivers while their parent is still active.`,
    );
    this.receiverAgentId = receiverAgentId;
  }
}

/** Throw when two handoffs in the same parent collide on tool name (D215). */
export class HandoffNameCollisionError extends Error {
  override readonly name = "HandoffNameCollisionError";
  readonly conflictingName: string;
  constructor(conflictingName: string) {
    super(
      `Two handoffs share the same tool name "${conflictingName}". ` +
        `Set { toolName } on at least one of them to disambiguate.`,
    );
    this.conflictingName = conflictingName;
  }
}

/**
 * Public `Handoff` shape — what `Handoff.create()` returns. Read-only
 * accessors only; behavior lives in the engine.
 *
 * @public
 */
export interface HandoffDescriptor<TInput extends ZodType = ZodType> {
  readonly target: SDKAgent;
  readonly options: HandoffOptions<TInput>;
  /** Resolved tool name (after applying toolName override or default `transfer_to_<receiver>`). */
  readonly resolvedToolName: string;
}
