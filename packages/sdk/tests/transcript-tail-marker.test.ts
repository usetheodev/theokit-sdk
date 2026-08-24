/**
 * T2.5 — `sinceMarker` matched a substring of the raw JSONL line.
 *
 * `l.includes(marker)` is true for ANY line containing the text, including a user message that
 * merely mentions it. Asking for records since `compact_boundary` and getting a window that starts
 * at the message where someone typed the words "compact_boundary" is silent data loss: the read
 * succeeds, returns fewer records than exist, and nothing says so.
 *
 * This was the measured reason the only would-be consumer declined the function and kept its own
 * reader (`TheoCode packages/agent/src/session/backtrack.ts:60-73`). It was found while verifying a
 * DIFFERENT gap (U-10), which is why it appears in no register.
 *
 * Caller audit before tightening: zero callers outside this module and zero tests referenced
 * `sinceMarker`, so narrowing the match breaks nothing that exists. A caller depending on the loose
 * behaviour would be depending on the defect.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";
import { readJsonlTail } from "../src/internal/persistence/transcript-ops.js";
import { removeTempDirRobustSync } from "./helpers/temp-workspace.js";

function writeLines(name: string, records: readonly unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "tail-marker-"));
  const __dirCleanup1 = dir;
  onTestFinished(() => {
    removeTempDirRobustSync(__dirCleanup1);
  });
  const path = join(dir, name);
  writeFileSync(path, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
  return path;
}

describe("readJsonlTail — sinceMarker is a record, not a substring", () => {
  it("test_a_message_containing_the_marker_text_does_not_truncate_the_read", () => {
    const path = writeLines("mention.jsonl", [
      { type: "user", text: "how does compact_boundary work?" },
      { type: "assistant", text: "it marks where history was compacted" },
      { type: "user", text: "got it" },
    ]);

    const tail = readJsonlTail<{ type: string; text?: string }>(path, {
      sinceMarker: "compact_boundary",
    });

    expect(
      tail,
      "a message that MENTIONS the marker is not the marker — truncating there loses records the " +
        "caller asked for, and reports success",
    ).toHaveLength(3);
  });

  it("test_a_real_marker_record_still_truncates", () => {
    const path = writeLines("real.jsonl", [
      { type: "user", text: "before" },
      { type: "system", subtype: "compact_boundary" },
      { type: "user", text: "after" },
    ]);

    const tail = readJsonlTail<{ type: string; text?: string }>(path, {
      sinceMarker: "compact_boundary",
    });

    expect(tail).toHaveLength(1);
    expect(tail[0]?.text).toBe("after");
  });

  it("test_the_LAST_marker_wins_when_several_are_present", () => {
    const path = writeLines("several.jsonl", [
      { type: "system", subtype: "compact_boundary" },
      { type: "user", text: "middle" },
      { type: "system", subtype: "compact_boundary" },
      { type: "user", text: "latest" },
    ]);

    const tail = readJsonlTail<{ text?: string }>(path, { sinceMarker: "compact_boundary" });

    expect(tail).toHaveLength(1);
    expect(tail[0]?.text).toBe("latest");
  });

  it("test_absent_marker_reads_the_whole_tail", () => {
    const path = writeLines("absent.jsonl", [
      { type: "user", text: "a" },
      { type: "user", text: "b" },
    ]);
    expect(readJsonlTail(path, { sinceMarker: "compact_boundary" })).toHaveLength(2);
  });

  // A "malformed line" case was drafted here and removed: `readJsonlTail` throws on invalid JSON
  // today, and changing that is a different contract from the one T2.5 is fixing. Asserting it
  // would have been scope creep dressed as coverage.
});
