/**
 * M7-6 — formatCostUsd honest-null render.
 */
import { describe, expect, it } from "vitest";
import { formatCostUsd } from "../src/format-cost.js";

describe("formatCostUsd (M7-6)", () => {
  it("renders an unknown cost (undefined) as the dash marker", () => {
    expect(formatCostUsd(undefined)).toBe("—");
  });

  it("renders a real known-zero as $0.00 (distinct from unknown)", () => {
    expect(formatCostUsd(0)).toBe("$0.00");
  });

  it("renders a number with two decimal places", () => {
    expect(formatCostUsd(1.5)).toBe("$1.50");
    expect(formatCostUsd(12.345)).toBe("$12.35");
  });

  it("honors a custom unknown marker and currency", () => {
    expect(formatCostUsd(undefined, { unknown: "n/a" })).toBe("n/a");
    expect(formatCostUsd(2, { currency: "US$" })).toBe("US$2.00");
  });
});
