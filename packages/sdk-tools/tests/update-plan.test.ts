import { describe, expect, it } from "vitest";

import { createUpdatePlanTool } from "../src/update-plan.js";
import { textHandler } from "./text-handler.js";

const plan = (...s: Array<["pending" | "in_progress" | "completed", string]>) =>
  s.map(([status, step]) => ({ step, status }));

describe("update_plan built-in (declarative, Codex-faithful)", () => {
  it("echoes the structured steps and flags no warning when exactly one is in_progress", async () => {
    const tool = createUpdatePlanTool();
    const r = JSON.parse(
      await textHandler(tool)({
        explanation: "starting",
        plan: plan(["completed", "read code"], ["in_progress", "write test"], ["pending", "ship"]),
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.explanation).toBe("starting");
    expect(r.steps).toEqual([
      { step: "read code", status: "completed" },
      { step: "write test", status: "in_progress" },
      { step: "ship", status: "pending" },
    ]);
    expect(r.warning).toBeUndefined();
  });

  it("warns (does not reject) when the one-in_progress invariant is violated", async () => {
    const tool = createUpdatePlanTool();
    const r = JSON.parse(
      await textHandler(tool)({
        plan: plan(["in_progress", "a"], ["in_progress", "b"]),
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/exactly one step in_progress/);
    expect(r.warning).toMatch(/found 2/);
  });

  it("does not warn when every step is completed", async () => {
    const tool = createUpdatePlanTool();
    const r = JSON.parse(
      await textHandler(tool)({ plan: plan(["completed", "a"], ["completed", "b"]) }),
    );
    expect(r.ok).toBe(true);
    expect(r.warning).toBeUndefined();
  });

  it("warns when zero steps are in_progress and not all done", async () => {
    const tool = createUpdatePlanTool();
    const r = JSON.parse(
      await textHandler(tool)({ plan: plan(["pending", "a"], ["completed", "b"]) }),
    );
    expect(r.warning).toMatch(/found 0/);
  });
});
