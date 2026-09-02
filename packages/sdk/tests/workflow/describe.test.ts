/**
 * theokit#161 — a workflow can describe its own shape, for a reflection surface.
 *
 * The issue asked for enumeration of `Workflow` INSTANCES and listed three options: a process
 * registry, a `workflows` field on `AgentOptions`, or nothing. The answer here is a fourth: a
 * workflow is a value the caller CONSTRUCTS AND HOLDS, so the caller already knows which ones
 * exist — what it lacked was a way to describe one. A registry would have added process-global
 * state that nothing releases, to re-answer a question the host can answer itself; an
 * `AgentOptions.workflows` field would have coupled two things that are independent today (a
 * workflow runs perfectly well without an agent).
 */
import { describe, expect, it } from "vitest";
import { fn, Workflow } from "../../src/workflow.js";

describe("theokit#161 — Workflow.describe()", () => {
  it("test_reports_the_name_and_every_top_level_step", () => {
    const wf = Workflow.create({ name: "ingest" })
      .then(fn("fetch", () => "raw"))
      .then(fn("parse", () => "parsed"))
      .commit();

    expect(wf.describe()).toEqual({
      name: "ingest",
      steps: [
        { id: "fetch", kind: "fn" },
        { id: "parse", kind: "fn" },
      ],
    });
  });

  it("test_a_parallel_step_reports_its_branch_steps_rather_than_reading_as_a_leaf", () => {
    // The case a flat list misrepresents: without recursion this workflow would describe as one
    // step, and a reflection endpoint would render a fan-out as a single box.
    const wf = Workflow.create({ name: "fanout" })
      .parallel([[fn("left", () => 1)], [fn("right", () => 2)]], { id: "both" })
      .commit();

    const described = wf.describe();
    expect(described.steps).toHaveLength(1);
    expect(described.steps[0]).toMatchObject({ id: "both", kind: "parallel" });
    expect(described.steps[0]?.steps?.map((s) => s.id)).toEqual(["left", "right"]);
  });

  it("test_no_executable_leaves_the_process", () => {
    // The same rule `Agent.describe()` follows: a reflection endpoint serializes what it is handed,
    // and a step's predicate/condition/fn is an executable that means nothing outside this process.
    const wf = Workflow.create({ name: "secretive" })
      .then(fn("compute", () => "NEVER-SERIALIZE-THIS-BODY"))
      .commit();

    const serialized = JSON.stringify(wf.describe());
    expect(serialized).not.toContain("NEVER-SERIALIZE-THIS-BODY");
    expect(Object.keys(wf.describe().steps[0] ?? {}).sort()).toEqual(["id", "kind"]);
  });

  it("test_a_host_enumerates_its_OWN_workflows_which_is_why_there_is_no_registry", () => {
    // What a `theokit dev` reflection endpoint actually does. No `Workflow.list()` exists, and this
    // is the counterproof that none is needed: the host holds the workflows it defined.
    const workflows = [
      Workflow.create({ name: "alpha" })
        .then(fn("a", () => 1))
        .commit(),
      Workflow.create({ name: "beta" })
        .then(fn("b", () => 2))
        .commit(),
    ];

    expect(workflows.map((w) => w.describe().name)).toEqual(["alpha", "beta"]);
    expect(Workflow).not.toHaveProperty("list");
  });
});
