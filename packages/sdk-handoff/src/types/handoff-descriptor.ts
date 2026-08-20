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
 * Read-only snapshot of a handoff about to happen, passed to `onHandoff` and `isEnabled`.
 *
 * @public
 */
export interface HandoffContext {
  /** The `parentAgentId` the wiring was built with — `"anonymous"` when it was left unset. */
  readonly senderAgentId: string;
  /** `agentId` of the target about to receive the conversation. */
  readonly receiverAgentId: string;
  /**
   * Hops recorded so far in this dispatch. Because chain state is rebuilt per tool invocation, it
   * is `1` for essentially every real handoff — it is not a running total across a `send()`.
   */
  readonly currentDepth: number;
  /**
   * Agent ids traversed, ending with the receiver this context describes. Same caveat as
   * `currentDepth`: it covers this dispatch, not the whole conversation.
   */
  readonly chain: ReadonlyArray<string>;
}

/**
 * The transcript wrapper passed to `inputFilter`. `messages` is widened to
 * `unknown[]` so this type doesn't import from `messages.ts` (avoids cycle
 * — implementations cast to `SDKMessage[]` internally).
 *
 * Always arrives EMPTY today — see {@link HandoffOptions.inputFilter}.
 *
 * @public
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
  /**
   * Name of the synthetic tool, replacing the derived `transfer_to_<slug>`.
   *
   * Taken verbatim — it is not validated against the provider's tool-name rules, and it is what the
   * collision check compares, so two targets sharing an explicit name still collide.
   */
  readonly toolName?: string;
  /**
   * Description shown to the model, replacing the generic "Transfer the conversation to the
   * `<agentId>` agent." This is the ONLY thing telling the model when to pick this target over its
   * siblings, so a default description in a multi-target setup routes badly.
   */
  readonly toolDescription?: string;
  /**
   * Called after the input is parsed and BEFORE the receiver is invoked. `parsed` is whatever
   * `inputType` produced, or `undefined` when no `inputType` was set.
   *
   * Awaited, and NOT isolated: throwing from here aborts the handoff, which is the supported way to
   * veto one after inspecting the arguments. Use it for logging and audit; the transfer has not
   * happened yet.
   */
  readonly onHandoff?: (
    ctx: HandoffContext,
    parsed: TInput extends ZodType ? unknown : undefined,
  ) => void | Promise<void>;
  /**
   * Zod schema for the arguments the model must supply, replacing the default
   * `{ reason?: string }`. It becomes the tool's JSON Schema, so it is also how you ask the model
   * for structured routing data.
   *
   * Parsed with `.parse()`, so a rejection aborts the handoff. Note the parsed value is used ONLY
   * for `onHandoff` and for lifting a `reason` field into telemetry — it is NOT forwarded to the
   * receiver, which sees only the message text.
   */
  readonly inputType?: TInput;
  /**
   * Hook to rewrite the transcript before the receiver sees it — the intended place for redaction.
   *
   * TODAY IT RECEIVES AN EMPTY HISTORY. Both wirings pass `{ messages: [] }` (history replay is
   * unimplemented), so this is called with nothing to filter and its result cannot change what the
   * receiver gets. Do not rely on it for redaction yet.
   *
   * Failures are swallowed: a throw falls back to the unfiltered history with one warning on
   * stderr per process — so a broken redactor fails OPEN, not closed.
   */
  readonly inputFilter?: (history: HandoffHistory) => HandoffHistory | Promise<HandoffHistory>;
  /**
   * DECLARED BUT NOT IMPLEMENTED. Nothing in this package reads it, so setting it neither restricts
   * nor grants the receiver any tool. It is reserved for a future tool allowlist; treat it as a
   * no-op today.
   */
  readonly tools?: ReadonlyArray<string>;
  /**
   * Gate on this handoff, as a boolean or a predicate evaluated at dispatch time with the same
   * `ctx` that `onHandoff` receives.
   *
   * `false` does NOT hide the tool from the model — the tool is still registered and still
   * offered; the dispatch simply fails with `Handoff to <id> is disabled (isEnabled returned
   * false)`, which the tool wiring hands back as a failed tool result. To remove a target from the
   * model's view, leave it out of `targets`.
   */
  readonly isEnabled?: boolean | ((ctx: HandoffContext) => boolean | Promise<boolean>);
}

/**
 * Result of a single handoff dispatch (for telemetry / observability).
 *
 * @public
 */
export interface HandoffResult {
  /** Sender agent id (the wiring's `parentAgentId`). */
  readonly from: string;
  /** Receiver agent id. */
  readonly to: string;
  /** Hops in this dispatch — effectively always 1, per {@link HandoffContext.currentDepth}. */
  readonly depth: number;
  /** The `transfer_to_*` tool that triggered it. */
  readonly toolName: string;
  /**
   * The `reason` field the model supplied, when `inputType` produced an object carrying one.
   * Absent when the model gave no reason or the schema has no such field.
   */
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
