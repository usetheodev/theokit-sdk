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

import type { SDKAgent } from "@theokit/sdk";
import type { ZodType } from "zod";
import type {
  HandoffContext,
  HandoffDescriptor as HandoffDescriptorGeneric,
  HandoffHistory,
  HandoffOptions,
  HandoffResult,
} from "./handoff-descriptor.js";

export type { HandoffContext, HandoffHistory, HandoffOptions, HandoffResult };

/**
 * What `Handoff.create` returns: a target plus its options plus the resolved tool name.
 *
 * Pinned to `SDKAgent` — the back-compat shape for callers who imported
 * `import type { HandoffDescriptor } from "@theokit/sdk"` before the T4.1 follow-up. It is a plain
 * data record: constructing one by hand works, and skips the target validation `Handoff.create`
 * performs.
 *
 * @public
 */
export type HandoffDescriptor<TInput extends ZodType = ZodType> = HandoffDescriptorGeneric<
  TInput,
  SDKAgent
>;

/**
 * Thrown when a chain exceeds `maxHandoffDepth` (default 5). `depth` is the CAP that was exceeded,
 * not the depth reached; `chain` is the full path of agent ids.
 *
 * Rare in practice: chain state is rebuilt per dispatch, so depth restarts at 1 on every tool call.
 * Repeated ping-pong surfaces as {@link HandoffPairLoopError} instead. *
 * WHERE YOU SEE IT: only when you drive a handoff yourself, via `handoffTo(...)`. In the
 * tool-based wirings (`Handoff.asPlugin` / `Agent.create({ handoffs })`) the handler catches every
 * error and hands the MODEL a `{"ok":false,"error":"<name>","message":"…"}` tool result, so this
 * class is observable there only as that `error` string.
 */
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

/**
 * Thrown when the same `sender -> receiver` pair fires twice inside one dispatch — the ping-pong
 * guard, and the loop protection that actually fires in practice.
 *
 * A -> B -> A is allowed by this check (different pairs); a repeated A -> B is not. *
 * WHERE YOU SEE IT: only when you drive a handoff yourself, via `handoffTo(...)`. In the
 * tool-based wirings (`Handoff.asPlugin` / `Agent.create({ handoffs })`) the handler catches every
 * error and hands the MODEL a `{"ok":false,"error":"<name>","message":"…"}` tool result, so this
 * class is observable there only as that `error` string.
 */
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

/**
 * Thrown when a target's `agentId` equals the parent's — self-handoff, which recurses forever.
 *
 * Compared against `parentAgentId` as a STRING, which defaults to `"anonymous"` in
 * `Handoff.asPlugin`: leave it unset and a genuine self-reference goes undetected.
 *
 * Raised while the target list is normalised, which in `Handoff.asPlugin` happens inside an
 * unawaited async registration — it arrives as an unhandled rejection there, not as a throw from
 * `Agent.create`.
 */
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

/**
 * Thrown when the target agent was disposed before the handoff reached it — detected at dispatch
 * time, since nothing unregisters the tool when an agent is disposed.
 *
 * Typical cause: the receiver was created in a narrower scope than the sender and cleaned up first. *
 * WHERE YOU SEE IT: only when you drive a handoff yourself, via `handoffTo(...)`. In the
 * tool-based wirings (`Handoff.asPlugin` / `Agent.create({ handoffs })`) the handler catches every
 * error and hands the MODEL a `{"ok":false,"error":"<name>","message":"…"}` tool result, so this
 * class is observable there only as that `error` string.
 */
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

/**
 * Thrown when two targets of the same parent resolve to the same `transfer_to_*` name — the model
 * would have no way to pick between them.
 *
 * Easy to hit without duplicate agents, but not in the way the folding rule suggests: `-` and `_`
 * SURVIVE the slug, and only runs of other characters fold to a single `_`, which is then trimmed
 * at both ends. So `"billing EU"`, `"billing_EU"`, `"billing.EU"` and `"billing (EU)"` all resolve
 * to `transfer_to_billing_EU` and collide — the last one because the `_` left by the closing paren
 * is trimmed off the end. `"billing-EU"` keeps its hyphen, resolves to `transfer_to_billing-EU`,
 * and collides with none of them. Set `toolName` on one of the colliding pair.
 *
 * Raised while the target list is normalised, which in `Handoff.asPlugin` happens inside an
 * unawaited async registration — it arrives as an unhandled rejection there, not as a throw from
 * `Agent.create`.
 */
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
