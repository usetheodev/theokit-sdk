import { describe, expect, it } from "vitest";
import { createPlanModeTool } from "../src/plan-mode.js";

describe("createPlanModeTool", () => {
  it("starts in normal mode", () => {
    const tool = createPlanModeTool();

    const result = JSON.parse(tool.handler({ action: "status" }));

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("normal");
  });

  it("enters plan mode", () => {
    const tool = createPlanModeTool();

    const result = JSON.parse(tool.handler({ action: "enter" }));

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("plan");
    expect(result.message).toContain("PLAN MODE");
    expect(tool.currentMode()).toBe("plan");
  });

  it("exits back to normal mode", () => {
    const tool = createPlanModeTool();
    tool.handler({ action: "enter" });

    const result = JSON.parse(tool.handler({ action: "exit" }));

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("normal");
    expect(tool.currentMode()).toBe("normal");
  });

  it("returns error for invalid action", () => {
    const tool = createPlanModeTool();

    const result = JSON.parse(tool.handler({ action: "invalid" }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_action");
  });

  it("has correct tool metadata", () => {
    const tool = createPlanModeTool();
    expect(tool.name).toBe("plan_mode");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema).toBeDefined();
  });
});
