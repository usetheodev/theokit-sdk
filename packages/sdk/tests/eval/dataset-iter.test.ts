/**
 * D210 — dataset normalization.
 */

import { describe, expect, it } from "vitest";

import { materializeDataset } from "../../src/internal/eval/dataset-iter.js";
import type { DatasetEntry } from "../../src/types/eval.js";

describe("materializeDataset (D210)", () => {
  it("accepts ReadonlyArray<DatasetEntry>", async () => {
    const arr: DatasetEntry[] = [{ input: "a" }, { input: "b" }];
    const out = await materializeDataset(arr);
    expect(out).toEqual(arr);
  });

  it("accepts factory returning Iterable (sync generator)", async () => {
    function* gen(): Iterable<DatasetEntry> {
      yield { input: "x" };
      yield { input: "y" };
    }
    const out = await materializeDataset(gen);
    expect(out.map((e) => e.input)).toEqual(["x", "y"]);
  });

  it("accepts factory returning AsyncIterable", async () => {
    async function* gen(): AsyncIterable<DatasetEntry> {
      yield { input: "p" };
      yield { input: "q" };
    }
    const out = await materializeDataset(gen);
    expect(out.map((e) => e.input)).toEqual(["p", "q"]);
  });

  it("preserves metadata field", async () => {
    const out = await materializeDataset([{ input: "a", metadata: { tag: "smoke" } }]);
    expect(out[0]?.metadata).toEqual({ tag: "smoke" });
  });

  it("empty array yields empty list", async () => {
    expect(await materializeDataset([])).toEqual([]);
  });
});
