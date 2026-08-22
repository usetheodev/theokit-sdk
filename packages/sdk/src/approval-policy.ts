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

/**
 * The three answers a policy can give: proceed, put the call in front of a human, or stop it.
 *
 * `ask` is not a softer `deny`. A surface with no way to reach a human must treat it as a refusal,
 * because treating it as permission is how an unattended run approves everything it was meant to
 * pause on.
 *
 * @public
 */
export type ApprovalOutcome = "allow" | "ask" | "deny";

/**
 * Which rule produced the outcome.
 *
 * The `explicitly-` pair means a per-tool list decided it; the `mode-` triple means no list named
 * the tool and the operator's mode decided instead. Worth rendering alongside the outcome: "you
 * denied this tool" and "your mode refuses everything" send the operator to different settings.
 *
 * @public
 */
export type ApprovalReason =
  | "explicitly-allowed"
  | "explicitly-denied"
  | "mode-ask"
  | "mode-never-ask"
  | "mode-refuse-all";

/**
 * One tool call to decide on, plus the operator's configuration.
 *
 * `tool` is matched against `denied` and `allowed` by exact string equality — there is no pattern
 * or prefix rule. Both lists default to empty, so with neither supplied every call is decided by
 * `mode` alone.
 *
 * @public
 */
export interface ApprovalInput {
  readonly tool: string;
  readonly mode: ApprovalMode;
  /** Tools the operator allowed once and for all. */
  readonly allowed?: readonly string[];
  /** Tools the operator refused. Outranks `allowed` and every mode. */
  readonly denied?: readonly string[];
}

/**
 * The answer, the rule that produced it, and the tool it was about.
 *
 * @public
 */
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
 * Decide one tool call against the operator's lists and mode.
 *
 * The precedence is fixed and each step short-circuits: `denied` is consulted first, then
 * `allowed`, then `mode`. A tool named in BOTH lists is therefore denied — a contradictory config
 * is read restrictively, because the usual cause is an allow-entry that outlived the denial meant
 * to replace it.
 *
 * This answers only who said yes. What the call REACHES is a separate question with a separate
 * policy — `evaluateBlastRadius` — and neither consults the other, so a product that wants both
 * gates calls both and combines the outcomes itself.
 *
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
