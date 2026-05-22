/**
 * D210 — normalize `Dataset` (array OR factory-of-iterable) into a
 * concrete `AsyncIterable<DatasetEntry>`. Then the runner materializes
 * the list (v1 doesn't stream the aggregate).
 *
 * @internal
 */

import type { Dataset, DatasetEntry } from "../../types/eval.js";

export async function* normalizeDataset(
  d: Dataset,
): AsyncGenerator<DatasetEntry, void, void> {
  if (Array.isArray(d)) {
    for (const entry of d) yield entry;
    return;
  }
  if (typeof d === "function") {
    const iterable = d();
    for await (const entry of iterable as AsyncIterable<DatasetEntry> | Iterable<DatasetEntry>) {
      yield entry;
    }
    return;
  }
  throw new Error(
    `Invalid dataset shape: expected Array<DatasetEntry> OR (() => Iterable<DatasetEntry> | AsyncIterable<DatasetEntry>); got ${typeof d}`,
  );
}

export async function materializeDataset(d: Dataset): Promise<DatasetEntry[]> {
  const out: DatasetEntry[] = [];
  for await (const entry of normalizeDataset(d)) out.push(entry);
  return out;
}
