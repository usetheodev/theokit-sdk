/**
 * B-100 bullet 2 — a tool declares its blast radius, so the approval layer gates on WHAT IT DOES
 * rather than on what it is called.
 *
 * Gating by name is what every product falls back to: an allowlist of strings that says nothing
 * about the action, drifts the moment a tool is renamed, and cannot be reviewed by anyone who did
 * not write it. `delete_namespace` and `list_pods` differ by a word to a policy engine.
 *
 * ## Why the declaration is a wrapper and not a schema field
 *
 * A tool's `inputSchema` is what the MODEL sees. Blast radius is not for the model — it is for the
 * approval layer, and putting it in the schema would both leak policy into the prompt and let a
 * model-authored argument influence its own gate. The declaration therefore rides ALONGSIDE the
 * tool, and `describeAction` is what the gate reads.
 *
 * ## Why bullets 1 and 3 are not implemented here
 *
 * They ask for concrete infrastructure tools — cluster query, metrics, logs, traces — and a second
 * product composing them. Each needs a real client (kubectl, a Prometheus dialect, a log backend),
 * and every one would be designed against zero measured consumers. That is the mistake B-104
 * recorded and its resolution avoided: publish the RULE, let the vocabulary arrive from whoever has
 * the cluster. What ships here is the seam those tools declare through.
 */

import { describe, expect, it } from "vitest";

import { evaluateBlastRadius } from "../src/blast-radius.js";
import { describeAction, withBlastRadius } from "../src/tool-blast-radius.js";

const fakeTool = (name: string) => ({ name, description: "x" });

describe("withBlastRadius — the declaration rides with the tool", () => {
  it("test_a_declared_tool_reports_the_action_it_takes", () => {
    const tool = withBlastRadius(fakeTool("list_pods"), {
      scope: "cluster:prod",
      reversible: true,
    });

    expect(describeAction(tool)).toEqual({ scope: "cluster:prod", reversible: true });
  });

  it("test_the_tool_itself_is_unchanged", () => {
    // The wrapper must not disturb what the MODEL sees. A declaration that altered the tool's name
    // or description would change the prompt to satisfy a policy layer.
    const original = fakeTool("list_pods");
    const wrapped = withBlastRadius(original, { scope: "cluster:prod", reversible: true });

    expect(wrapped.name).toBe("list_pods");
    expect(wrapped.description).toBe("x");
  });

  it("test_the_declaration_does_not_reach_a_prompt", () => {
    // The reason it is non-enumerable and symbol-keyed, and nothing asserted it until a mutation
    // flipped `enumerable` to true and every case stayed green. A tool is serialised on its way to
    // the model; a policy field riding along would both leak the gate into the prompt and invite a
    // model-authored argument to influence its own approval.
    const tool = withBlastRadius(fakeTool("list_pods"), {
      scope: "cluster:prod",
      reversible: true,
    });

    expect(JSON.stringify(tool)).not.toContain("cluster:prod");
    expect(Object.keys(tool)).toEqual(["name", "description"]);
  });

  it("test_an_undeclared_tool_describes_no_action", () => {
    // Not an empty action — `undefined`, so the gate can tell "never declared" from "declared as
    // reaching nothing". Collapsing them is how an unreviewed tool passes as harmless.
    expect(describeAction(fakeTool("mystery"))).toBeUndefined();
  });
});

describe("withBlastRadius — what the gate does with it", () => {
  it("test_a_declared_read_tool_is_allowed_in_a_granted_scope", () => {
    const tool = withBlastRadius(fakeTool("list_pods"), {
      scope: "cluster:prod",
      reversible: true,
    });
    const action = describeAction(tool);

    expect(action).toBeDefined();
    expect(evaluateBlastRadius({ action: action!, granted: ["cluster:prod"] }).outcome).toBe(
      "allow",
    );
  });

  it("test_a_declared_destructive_tool_requires_approval_in_the_same_scope", () => {
    // The distinction gating by NAME cannot make: same scope, same operator grant, different action.
    const tool = withBlastRadius(fakeTool("delete_namespace"), {
      scope: "cluster:prod",
      reversible: false,
    });

    expect(
      evaluateBlastRadius({ action: describeAction(tool)!, granted: ["cluster:prod"] }).outcome,
    ).toBe("require-approval");
  });

  it("test_two_tools_with_the_same_name_but_different_scopes_gate_differently", () => {
    // Anti-vacuity for the whole mechanism: if the gate still keyed on the name, these would agree.
    const prod = withBlastRadius(fakeTool("apply"), { scope: "cluster:prod", reversible: false });
    const staging = withBlastRadius(fakeTool("apply"), {
      scope: "cluster:staging",
      reversible: false,
    });
    const granted = ["cluster:staging"];

    expect(evaluateBlastRadius({ action: describeAction(prod)!, granted }).outcome).toBe("refuse");
    expect(evaluateBlastRadius({ action: describeAction(staging)!, granted }).outcome).toBe(
      "require-approval",
    );
  });
});
