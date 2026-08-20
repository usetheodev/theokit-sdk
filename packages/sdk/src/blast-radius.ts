/**
 * Decide an action by what it REACHES and whether it can be undone — not by its name.
 *
 * A sandbox answers "which files may this process touch", and that is a different question from the
 * one that decides whether an action is safe. A tool that drops a production database touches no
 * file the sandbox cares about; a tool that lists pods reaches an entire cluster while writing
 * nothing. Confinement covers the disk, not the reach.
 *
 * With nothing better available, every product gates on the tool's NAME: an allowlist of strings
 * that says nothing about what the tool does, drifts the moment one is renamed, and cannot be
 * reasoned about by anyone who did not write it. A guard each product re-implements is a guard some
 * product forgets.
 *
 * ## What is generic here, and what is not
 *
 * The RULE is: an action declares the scope it reaches and whether it is reversible, and a policy
 * decides from those two facts plus what the operator granted. The VOCABULARY is not — which scopes
 * exist ("cluster:prod", "billing-account", "the laptop") belongs to the product and arrives as
 * data. Nothing in this module names a scope, the same way the security floor names no sandbox mode
 * and the trust posture names no capability.
 *
 * ## Why the reason is part of the answer
 *
 * "The sandbox stopped this" and "you never granted reach to that scope" are different facts with
 * different fixes, and an operator told the wrong one widens the wrong thing. So a decision carries
 * WHY — the same reason a trust posture reports its `source` and a wiring record distinguishes
 * withheld-by-trust from never-configured.
 *
 * @public
 */

/** What an action reaches, and whether it can be taken back. @public */
export interface DeclaredAction {
  /**
   * The product's name for what this action reaches. An empty string is treated as UNDECLARED and
   * refused: a tool that forgot to declare is not a tool that reaches nothing.
   */
  readonly scope: string;
  /**
   * Whether the action can be undone. Reversible actions inside a granted scope proceed;
   * irreversible ones ask, because granting reach is not granting destruction.
   */
  readonly reversible: boolean;
}

/**
 * The action to decide on, plus what the operator granted.
 *
 * `granted` is matched against `action.scope` by exact string equality: there is no prefix or
 * wildcard rule, so granting `cluster:prod` does not grant `cluster:prod:kube-system`. A product
 * that wants hierarchical scopes expands them itself before calling.
 *
 * `irreversibleAllowed` defaults to empty, so an irreversible action inside a granted scope asks
 * for approval unless its scope was pre-approved for destruction as well.
 *
 * @public
 */
export interface BlastRadiusInput {
  readonly action: DeclaredAction;
  /** Scopes the operator granted reach to. Empty grants nothing — never everything. */
  readonly granted: readonly string[];
  /** Scopes where the operator pre-approved irreversible actions, so an unattended run can work. */
  readonly irreversibleAllowed?: readonly string[];
}

/**
 * What the policy decided.
 *
 * `require-approval` means a human has to say yes before the action runs; a caller with no way to
 * ask must treat it as a refusal. `refuse` is not appealable through this policy at all — the
 * operator has to grant the scope first, which is deliberately a configuration change rather than
 * a prompt.
 *
 * @public
 */
export type BlastRadiusOutcome = "allow" | "require-approval" | "refuse";

/** Why the decision came out that way. Rendered to the operator and read by an audit. @public */
export type BlastRadiusReason =
  | "within-granted-scope"
  | "irreversible"
  | "scope-not-granted"
  | "scope-undeclared";

/**
 * The outcome, the rule that produced it, and the scope it was decided about.
 *
 * `scope` echoes what the action declared, so it is the empty string when the reason is
 * `scope-undeclared` — the decision names what it saw rather than substituting a placeholder.
 *
 * @public
 */
export interface BlastRadiusDecision {
  readonly outcome: BlastRadiusOutcome;
  readonly reason: BlastRadiusReason;
  /** The scope the decision was made about, so a surface can name it without re-deriving it. */
  readonly scope: string;
}

/**
 * Decide one declared action against the scopes the operator granted.
 *
 * Four checks, in this order, each short-circuiting: an empty `scope` is refused as undeclared
 * before any comparison happens; a scope absent from `granted` is refused; an irreversible action
 * whose scope is not in `irreversibleAllowed` escalates to approval; anything left is allowed.
 *
 * Refusal outranking escalation is a decision, not an accident. Asking a human to approve a scope
 * the operator never granted trains them to approve by reflex, which is how an approval prompt
 * stops being a control.
 *
 * This decides reach only. Whether the operator permitted the tool at all is `decideApproval`, and
 * the two are independent.
 *
 * @returns the outcome with the reason and the scope it was decided on.
 * @public
 */
export function evaluateBlastRadius(input: BlastRadiusInput): BlastRadiusDecision {
  const { scope, reversible } = input.action;

  // Undeclared first: a tool that forgot to declare must not fall through to a scope comparison
  // against `""`, which any product using an empty-string scope would accidentally satisfy.
  if (scope.length === 0) {
    return { outcome: "refuse", reason: "scope-undeclared", scope };
  }

  // Refusal outranks approval, deliberately. Asking a human to approve something the operator never
  // granted reach for teaches them to approve by reflex, which is how an approval prompt stops
  // being a control.
  if (!input.granted.includes(scope)) {
    return { outcome: "refuse", reason: "scope-not-granted", scope };
  }

  if (!reversible && !(input.irreversibleAllowed ?? []).includes(scope)) {
    return { outcome: "require-approval", reason: "irreversible", scope };
  }

  return { outcome: "allow", reason: "within-granted-scope", scope };
}
