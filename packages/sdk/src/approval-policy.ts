/**
 * Decide whether a tool call proceeds, and say WHY — as a typed signal rather than a tool result.
 *
 * When a veto is delivered as an ordinary tool result, the MODEL reads it as output: it sees a
 * string, concludes the tool failed for some reason, and retries or works around it. A denial, an
 * error, and a tool that legitimately returned the word "denied" become indistinguishable to
 * everything downstream — including the surface that should be telling the user what happened.
 *
 * ## What is generic, and what is not
 *
 * The RULE is a precedence: an explicit per-tool decision outranks the mode, a convenience mode does
 * not overturn an explicit refusal, and anything undecided falls to the mode. The VOCABULARY is not
 * — which tools exist belongs to the product and arrives as data. Nothing here names one.
 *
 * Deliberately separate from the blast-radius policy: that one answers "what does this action
 * reach", this one answers "who said yes". Keeping them apart is what lets a product gate on reach
 * without re-implementing the mode ladder, and compose both where it needs to.
 *
 * @public
 */

/** What the operator chose for everything not decided per tool. @public */
export type ApprovalMode = "ask" | "never-ask" | "refuse-all";

/** @public */
export type ApprovalOutcome = "allow" | "ask" | "deny";

/** @public */
export type ApprovalReason =
  | "explicitly-allowed"
  | "explicitly-denied"
  | "mode-ask"
  | "mode-never-ask"
  | "mode-refuse-all";

/** @public */
export interface ApprovalInput {
  readonly tool: string;
  readonly mode: ApprovalMode;
  /** Tools the operator allowed once and for all. */
  readonly allowed?: readonly string[];
  /** Tools the operator refused. Outranks `allowed` and every mode. */
  readonly denied?: readonly string[];
}

/** @public */
export interface ApprovalDecision {
  readonly outcome: ApprovalOutcome;
  readonly reason: ApprovalReason;
  /** The tool the decision was about, so a surface names it without re-deriving it. */
  readonly tool: string;
}

const BY_MODE: Readonly<
  Record<ApprovalMode, { outcome: ApprovalOutcome; reason: ApprovalReason }>
> = {
  ask: { outcome: "ask", reason: "mode-ask" },
  "never-ask": { outcome: "allow", reason: "mode-never-ask" },
  "refuse-all": { outcome: "deny", reason: "mode-refuse-all" },
};

/**
 * @returns the outcome, why it was reached, and the tool it was about.
 * @public
 */
export function decideApproval(input: ApprovalInput): ApprovalDecision {
  const { tool } = input;

  // Denial first, and it outranks everything. A contradictory config — a tool in both lists — is a
  // product bug, and the safe reading is the restrictive one: silently taking the permissive side is
  // how a stale allow-entry outlives the denial that was meant to replace it.
  if ((input.denied ?? []).includes(tool)) {
    return { outcome: "deny", reason: "explicitly-denied", tool };
  }
  if ((input.allowed ?? []).includes(tool)) {
    return { outcome: "allow", reason: "explicitly-allowed", tool };
  }

  const fromMode = BY_MODE[input.mode];
  return { outcome: fromMode.outcome, reason: fromMode.reason, tool };
}
