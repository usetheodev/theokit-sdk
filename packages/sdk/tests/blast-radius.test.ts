/**
 * B-101 — confinement covers the disk, not the reach.
 *
 * A sandbox answers "which files may this process touch". It cannot answer the question that
 * actually decides whether an action is safe: what does this action REACH, and can it be undone? A
 * tool that deletes a production database touches no file the sandbox cares about, and a tool that
 * lists pods reaches a whole cluster while writing nothing.
 *
 * So every product ends up gating on the tool's NAME — an allowlist of strings that says nothing
 * about what the tool does, drifts the moment a tool is renamed, and cannot be reasoned about by
 * anyone who did not write it. A guard each product re-implements is a guard some product forgets.
 *
 * ## What is generic, and what is not
 *
 * The RULE is: an action declares the scope it reaches and whether it can be undone, and a policy
 * decides from those two facts plus what the operator allowed. The VOCABULARY is not — which scopes
 * exist in a given product ("cluster", "billing-account", "the laptop") is that product's, and
 * arrives as data. Nothing in this module names a scope.
 *
 * ## The distinction the third DoD bullet is about
 *
 * A refusal must say WHICH guard refused. "The sandbox stopped this" and "you never granted reach
 * to that scope" are different facts with different fixes, and collapsing them sends the operator
 * to widen the wrong thing — the same reason the trust posture reports its `source`, and the wiring
 * record distinguishes withheld from never-configured.
 */

import { describe, expect, it } from "vitest";

import { type DeclaredAction, evaluateBlastRadius } from "../src/blast-radius.js";

/** A product's scopes. Deliberately not a set this package could have guessed. */
const READ_PODS: DeclaredAction = { scope: "cluster:prod", reversible: true };
const DELETE_PODS: DeclaredAction = { scope: "cluster:prod", reversible: false };
const READ_STAGING: DeclaredAction = { scope: "cluster:staging", reversible: true };

const GRANTED = ["cluster:prod", "cluster:staging"];

describe("evaluateBlastRadius — reach is granted, not assumed", () => {
  it("test_an_action_inside_a_granted_scope_is_allowed", () => {
    const decision = evaluateBlastRadius({ action: READ_PODS, granted: GRANTED });

    expect(decision.outcome).toBe("allow");
  });

  it("test_an_action_outside_every_granted_scope_is_refused", () => {
    const decision = evaluateBlastRadius({ action: READ_PODS, granted: ["cluster:staging"] });

    expect(decision.outcome).toBe("refuse");
  });

  it("test_the_refusal_says_reach_rather_than_sandbox", () => {
    // The third DoD bullet. "The sandbox stopped this" and "you never granted that scope" have
    // different fixes, and an operator told the wrong one widens the wrong thing.
    const decision = evaluateBlastRadius({ action: READ_PODS, granted: [] });

    expect(decision.reason).toBe("scope-not-granted");
    expect(decision.scope).toBe("cluster:prod");
  });

  it("test_granting_nothing_refuses_rather_than_allowing_everything", () => {
    // The direction an empty list must fail in. Reading it as "no restrictions" is the single most
    // expensive default a reach policy can have.
    expect(evaluateBlastRadius({ action: READ_STAGING, granted: [] }).outcome).toBe("refuse");
  });
});

describe("evaluateBlastRadius — an irreversible action is not an ordinary one", () => {
  it("test_an_irreversible_action_in_a_granted_scope_requires_approval", () => {
    // Granting reach is not granting destruction. A product that conflates them has no way to let
    // an agent read a cluster without also letting it delete one.
    const decision = evaluateBlastRadius({ action: DELETE_PODS, granted: GRANTED });

    expect(decision.outcome).toBe("require-approval");
    expect(decision.reason).toBe("irreversible");
  });

  it("test_an_irreversible_action_outside_the_granted_scope_is_refused_not_escalated", () => {
    // Refusal outranks approval: asking a human to approve something the operator never granted
    // reach for teaches them to approve by reflex.
    const decision = evaluateBlastRadius({ action: DELETE_PODS, granted: ["cluster:staging"] });

    expect(decision.outcome).toBe("refuse");
    expect(decision.reason).toBe("scope-not-granted");
  });

  it("test_a_reversible_action_is_not_escalated", () => {
    // Anti-vacuity: requiring approval for everything would satisfy the case above while making
    // the distinction useless.
    expect(evaluateBlastRadius({ action: READ_PODS, granted: GRANTED }).outcome).toBe("allow");
  });

  it("test_an_operator_may_pre_approve_irreversible_actions_in_a_scope", () => {
    // Otherwise an unattended run cannot do the job it was given, and the product's answer would be
    // to stop declaring actions irreversible — which loses the signal entirely.
    const decision = evaluateBlastRadius({
      action: DELETE_PODS,
      granted: GRANTED,
      irreversibleAllowed: ["cluster:prod"],
    });

    expect(decision.outcome).toBe("allow");
  });

  it("test_pre_approval_does_not_leak_across_scopes", () => {
    const decision = evaluateBlastRadius({
      action: DELETE_PODS,
      granted: GRANTED,
      irreversibleAllowed: ["cluster:staging"],
    });

    expect(decision.outcome).toBe("require-approval");
  });
});

describe("evaluateBlastRadius — the decision names what it decided on", () => {
  it("test_an_allowed_decision_still_reports_the_scope_it_matched", () => {
    // What a surface renders, and what an audit reads afterwards. A bare "allowed" cannot be
    // reviewed later against what the operator thought they granted.
    const decision = evaluateBlastRadius({ action: READ_PODS, granted: GRANTED });

    expect(decision.scope).toBe("cluster:prod");
    expect(decision.reason).toBe("within-granted-scope");
  });

  it("test_an_action_declaring_no_scope_is_refused_rather_than_defaulted", () => {
    // A tool that forgot to declare is not a tool that reaches nothing. Defaulting to "allow" makes
    // the whole mechanism opt-in, and the tools most worth gating are the ones written in a hurry.
    const decision = evaluateBlastRadius({
      action: { scope: "", reversible: true },
      granted: GRANTED,
    });

    expect(decision.outcome).toBe("refuse");
    expect(decision.reason).toBe("scope-undeclared");
  });
});
