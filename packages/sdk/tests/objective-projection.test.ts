import { describe, expect, it } from "vitest";

import { InMemoryConversationStorage } from "../src/internal/persistence/conversation-storage-memory.js";
import {
  formatObjectiveProjection,
  resolveCurrentObjectiveText,
} from "../src/internal/runtime/local-agent/local-agent-goal-extensions.js";
import {
  setObjective,
  writeObjectiveProgress,
} from "../src/internal/runtime/objective/objective-store.js";

/**
 * SE34 (ADR 0013) — the `<current-objective>` context projection. Only an ACTIVE
 * durable objective is projected; the format prepends the signal to the assembled
 * system prompt (or stands alone). Deterministic — no send / no LLM.
 */

describe("SE34 — <current-objective> projection", () => {
  it("resolveCurrentObjectiveText returns the text only when the objective is ACTIVE", async () => {
    const s = new InMemoryConversationStorage();
    expect(await resolveCurrentObjectiveText(s, "t1")).toBeUndefined(); // unset

    await setObjective(s, "t1", "Ship the /health endpoint");
    expect(await resolveCurrentObjectiveText(s, "t1")).toBe("Ship the /health endpoint");

    // A done / paused objective is NOT projected (nothing to work toward this turn).
    await writeObjectiveProgress(s, "t1", { runsUsed: 1, status: "done" });
    expect(await resolveCurrentObjectiveText(s, "t1")).toBeUndefined();
    await writeObjectiveProgress(s, "t1", { runsUsed: 1, status: "paused" });
    expect(await resolveCurrentObjectiveText(s, "t1")).toBeUndefined();
  });

  it("formatObjectiveProjection prepends the signal to an assembled prompt", () => {
    const out = formatObjectiveProjection("Do the thing", "You are a helpful agent.");
    expect(out).toBe(
      "<current-objective>\nDo the thing\n</current-objective>\n\nYou are a helpful agent.",
    );
  });

  it("formatObjectiveProjection stands alone when there is no assembled prompt", () => {
    expect(formatObjectiveProjection("Do the thing", undefined)).toBe(
      "<current-objective>\nDo the thing\n</current-objective>",
    );
    expect(formatObjectiveProjection("Do the thing", "")).toBe(
      "<current-objective>\nDo the thing\n</current-objective>",
    );
  });
});
