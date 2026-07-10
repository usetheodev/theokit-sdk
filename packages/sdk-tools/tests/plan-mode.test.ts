import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionArtifactStore } from "../src/artifact-store.js";
import { createPlanModeTool } from "../src/plan-mode.js";
import { textHandler } from "./text-handler.js";

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

  it("zero-arg handler stays synchronous (returns a string, not a Promise)", () => {
    const tool = createPlanModeTool();
    const out = tool.handler({ action: "enter" });
    expect(typeof out).toBe("string");
  });
});

describe("createPlanModeTool with artifactStore (M4-4 opt-in persistence)", () => {
  async function withStore<T>(
    fn: (dir: string, store: ReturnType<typeof createSessionArtifactStore>) => Promise<T>,
  ): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "plan-mode-store-"));
    try {
      return await fn(dir, createSessionArtifactStore({ dir }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("persists the plan on exit", async () => {
    await withStore(async (_dir, store) => {
      const tool = createPlanModeTool({ artifactStore: store, artifactId: "run-9" });
      const result = JSON.parse(
        await textHandler(tool)({ action: "exit", plan: "1. do X\n2. do Y" }),
      );
      expect(result.persisted).toBe(true);
      expect(tool.currentMode()).toBe("normal");
      expect(await store.read("run-9")).toBe("1. do X\n2. do Y");
    });
  });

  it("(EC-1) exit without a plan does not persist", async () => {
    await withStore(async (_dir, store) => {
      const tool = createPlanModeTool({ artifactStore: store });
      const result = JSON.parse(await textHandler(tool)({ action: "exit" }));
      expect(result.persisted).toBe(false);
      expect(result.mode).toBe("normal");
      expect(await store.list()).toEqual([]);
    });
  });

  it("(EC-2) enter does not persist", async () => {
    await withStore(async (_dir, store) => {
      const tool = createPlanModeTool({ artifactStore: store });
      await textHandler(tool)({ action: "enter" });
      expect(await store.list()).toEqual([]);
    });
  });

  it("store variant returns invalid_action for an unknown action (no persist)", async () => {
    await withStore(async (_dir, store) => {
      const tool = createPlanModeTool({ artifactStore: store });
      const result = JSON.parse(await textHandler(tool)({ action: "bogus" }));
      expect(result.ok).toBe(false);
      expect(result.error).toBe("invalid_action");
      expect(await store.list()).toEqual([]);
    });
  });
});
