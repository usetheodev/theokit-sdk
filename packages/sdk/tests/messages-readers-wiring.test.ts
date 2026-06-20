import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assistantText, costAmountUsd, extractToolUses } from "../src/messages.js";
import type { SDKAssistantMessage } from "../src/types/messages.js";
import type { CostBreakdown } from "../src/types/usage.js";

/**
 * M1-5 — integration: the readers work end-to-end on a realistic
 * `SDKAssistantMessage` + `CostBreakdown` (the boundary a consumer hits), and
 * the `@theokit/sdk/messages` sub-path is declared so Node ESM can resolve it.
 */

describe("messages readers wiring (M1-5)", () => {
  it("test_readers_importable_and_work_on_realistic_message", () => {
    const msg: SDKAssistantMessage = {
      type: "assistant",
      agent_id: "agent-x",
      run_id: "run-1",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Let me read that file. " },
          { type: "tool_use", id: "tu-1", name: "read_file", input: { path: "a.ts" } },
          { type: "text", text: "Done." },
        ],
      },
    };
    const c: CostBreakdown = {
      amountUsd: 0.0042,
      status: "actual",
      currency: "USD",
      source: "openrouter_api",
      pricingVersion: "2026-06",
    };

    expect(assistantText(msg)).toBe("Let me read that file. Done.");
    expect(extractToolUses(msg).map((b) => b.name)).toEqual(["read_file"]);
    expect(costAmountUsd(c)).toBe(0.0042);
    // honesty: unknown cost stays undefined through the reader
    expect(costAmountUsd({ ...c, amountUsd: undefined, status: "unknown" })).toBeUndefined();
  });

  it("test_subpath_declared_in_package_json", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(pkg.exports["./messages"]).toBeDefined();
  });
});
