/**
 * Type-leaf — `HandoffDescriptor` extracted as a generic over `TAgent` so
 * neither `agent.ts` nor `handoff.ts` need to import the other for type
 * resolution. Closes the audit's last LOW type-only cycle #4
 * (`types/agent.ts ↔ types/handoff.ts`) per plan
 * arch-review-fixes-2026-06-06 § Phase 4 / T4.1 follow-up.
 *
 * BREAKING (per user direction "sem retro compat"): `HandoffDescriptor`
 * gained a second generic parameter `TAgent` for the target shape. Existing
 * consumers using `HandoffDescriptor<MyInput>` now resolve to
 * `HandoffDescriptor<MyInput, SDKAgent>` via the back-compat default in
 * `handoff.ts`'s re-export.
 *
 * @public
 */

import type { ZodType } from "zod";

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
  readonly onHandoff?: (
    ctx: HandoffContext,
    parsed: TInput extends ZodType ? unknown : undefined,
  ) => void | Promise<void>;
  readonly inputType?: TInput;
  readonly inputFilter?: (history: HandoffHistory) => HandoffHistory | Promise<HandoffHistory>;
  readonly tools?: ReadonlyArray<string>;
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

/**
 * Public `Handoff` shape — what `Handoff.create()` returns. Read-only
 * accessors only; behavior lives in the engine.
 *
 * Generic over `TAgent` so this leaf has no dependency on a concrete
 * agent type. Consumers typically import the convenience alias
 * `HandoffDescriptor<TInput>` from `@theokit/sdk` which fixes `TAgent`
 * to `SDKAgent`.
 *
 * @public
 */
export interface HandoffDescriptor<TInput extends ZodType = ZodType, TAgent = unknown> {
  readonly target: TAgent;
  readonly options: HandoffOptions<TInput>;
  /** Resolved tool name (after applying toolName override or default `transfer_to_<receiver>`). */
  readonly resolvedToolName: string;
}
