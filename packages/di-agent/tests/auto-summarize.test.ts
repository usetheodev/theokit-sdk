import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { AutoSummarize, readAutoSummarizeMetadata } from "../src/decorators/auto-summarize.js";

describe("@AutoSummarize", () => {
  it("stores config on decorated class", () => {
    @AutoSummarize({ triggerFraction: 0.9 })
    class MyAgent {}
    const meta = readAutoSummarizeMetadata(MyAgent);
    expect(meta?.triggerFraction).toBe(0.9);
  });

  it("applies defaults when called without args", () => {
    @AutoSummarize()
    class MyAgent {}
    const meta = readAutoSummarizeMetadata(MyAgent);
    expect(meta?.triggerFraction).toBe(0.85);
    expect(meta?.keepNewest).toBe(4);
  });

  it("preserves custom keepNewest", () => {
    @AutoSummarize({ keepNewest: 8 })
    class A {}
    expect(readAutoSummarizeMetadata(A)?.keepNewest).toBe(8);
  });

  it("preserves custom model", () => {
    @AutoSummarize({ model: "gpt-4o-mini" })
    class A {}
    expect(readAutoSummarizeMetadata(A)?.model).toBe("gpt-4o-mini");
  });

  it("returns undefined for undecorated class", () => {
    class Plain {}
    expect(readAutoSummarizeMetadata(Plain)).toBeUndefined();
  });

  it("isolates metadata between classes", () => {
    @AutoSummarize({ triggerFraction: 0.5 })
    class A {}

    @AutoSummarize({ triggerFraction: 0.9 })
    class B {}

    expect(readAutoSummarizeMetadata(A)?.triggerFraction).toBe(0.5);
    expect(readAutoSummarizeMetadata(B)?.triggerFraction).toBe(0.9);
  });
});
