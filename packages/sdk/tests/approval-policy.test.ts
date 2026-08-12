/**
 * B-098 — an approval decision is a typed signal, not a tool result that happens to say "denied".
 *
 * The defect this prevents is quiet by construction. When a veto is delivered as an ordinary tool
 * result, the MODEL reads it as output: it sees a string, decides the tool failed for some reason,
 * and tries again — or worse, works around it. A denial and an error are indistinguishable to
 * everything downstream, and so is a denial and a tool that legitimately returned "denied".
 *
 * ## What is generic, and what is not
 *
 * The RULE is a precedence: an explicit per-tool decision outranks the mode, a mode of "never ask"
 * does not override an explicit refusal, and anything not decided falls to the mode. The VOCABULARY
 * is not — which modes a product offers and what its tools are called belong to the product, and
 * arrive as data. Nothing here names a tool.
 *
 * This is deliberately the same shape as the blast-radius policy (B-101), and the two compose: that
 * one answers "what does this reach", this one answers "who said yes". Keeping them separate is
 * what lets a product require approval for reach without re-implementing the mode ladder.
 */

import { describe, expect, it } from "vitest";

import { decideApproval } from "../src/approval-policy.js";

describe("decideApproval — the mode decides what was not decided explicitly", () => {
  it("test_ask_mode_asks", () => {
    expect(decideApproval({ tool: "write", mode: "ask" }).outcome).toBe("ask");
  });

  it("test_never_ask_mode_allows", () => {
    expect(decideApproval({ tool: "write", mode: "never-ask" }).outcome).toBe("allow");
  });

  it("test_refuse_all_mode_denies", () => {
    expect(decideApproval({ tool: "write", mode: "refuse-all" }).outcome).toBe("deny");
  });
});

describe("decideApproval — an explicit decision outranks the mode", () => {
  it("test_an_allowed_tool_is_allowed_even_in_ask_mode", () => {
    // What a remembered "always allow this" is for. Without it, a user re-approves the same tool
    // every turn and learns to approve without reading.
    const decision = decideApproval({ tool: "read", mode: "ask", allowed: ["read"] });

    expect(decision.outcome).toBe("allow");
    expect(decision.reason).toBe("explicitly-allowed");
  });

  it("test_a_denied_tool_is_denied_even_in_never_ask_mode", () => {
    // The precedence that matters most. "Never ask" is a convenience; an explicit refusal is a
    // decision, and a convenience must not overturn a decision.
    const decision = decideApproval({ tool: "rm", mode: "never-ask", denied: ["rm"] });

    expect(decision.outcome).toBe("deny");
    expect(decision.reason).toBe("explicitly-denied");
  });

  it("test_denial_outranks_allowance_when_a_tool_is_in_both_lists", () => {
    // A contradictory config is a product bug, and the safe reading is the restrictive one. Silently
    // picking the permissive side is how a stale allow-entry outlives the denial that replaced it.
    const decision = decideApproval({ tool: "rm", mode: "ask", allowed: ["rm"], denied: ["rm"] });

    expect(decision.outcome).toBe("deny");
  });

  it("test_an_unlisted_tool_still_falls_to_the_mode", () => {
    // Anti-vacuity: if every tool were treated as explicitly decided, the mode would never apply.
    expect(decideApproval({ tool: "other", mode: "ask", allowed: ["read"] }).outcome).toBe("ask");
  });
});

describe("decideApproval — the decision is legible", () => {
  it("test_every_outcome_carries_the_reason_it_was_reached", () => {
    // What a surface renders and an audit reads. "Denied" alone cannot be reviewed against what the
    // operator thought they configured.
    expect(decideApproval({ tool: "w", mode: "never-ask" }).reason).toBe("mode-never-ask");
    expect(decideApproval({ tool: "w", mode: "ask" }).reason).toBe("mode-ask");
    expect(decideApproval({ tool: "w", mode: "refuse-all" }).reason).toBe("mode-refuse-all");
  });

  it("test_the_decision_names_the_tool_it_was_about", () => {
    expect(decideApproval({ tool: "specific_tool", mode: "ask" }).tool).toBe("specific_tool");
  });
});
