/**
 * Public types for `Agent.create({ handoffs })` + `Handoff.create()` +
 * `Agent.handoffTo()` (Adoption Roadmap #4; ADRs D214-D229).
 *
 * Pattern: handoff-as-tool. Each handoff destination becomes a synthetic
 * `transfer_to_<receiver>` function tool exposed to the LLM. Runtime
 * intercepts the tool call and routes the next turn to the receiver.
 *
 * T4.1 follow-up (cycle #4 closed): `HandoffDescriptor` + its leaf-friendly
 * sibling types now live in `./handoff-descriptor.ts` (generic over
 * `TAgent`). This module re-exports the leaf types pinned to `SDKAgent`,
 * keeps the runtime error classes, and removes the back-edge to `agent.ts`.
 *
 * @public
 */

import type { ZodType } from "zod";

import type { SDKAgent } from "./agent.js";
import type {
  HandoffContext,
  HandoffDescriptor as HandoffDescriptorGeneric,
  HandoffHistory,
  HandoffOptions,
  HandoffResult,
} from "./handoff-descriptor.js";

export type { HandoffContext, HandoffHistory, HandoffOptions, HandoffResult };

/**
 * `HandoffDescriptor` pinned to `SDKAgent` — back-compat shape for callers
 * that imported `import type { HandoffDescriptor } from "@theokit/sdk"`
 * before T4.1 follow-up.
 *
 * @public
 */
export type HandoffDescriptor<TInput extends ZodType = ZodType> = HandoffDescriptorGeneric<
  TInput,
  SDKAgent
>;

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
