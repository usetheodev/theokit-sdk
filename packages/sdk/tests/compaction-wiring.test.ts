import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildCheckpoint,
  type CompressibleMessage,
  compactTranscript,
  filterFromLatestCheckpoint,
  isContextOverflowError,
} from "../src/compaction.js";
import { TheokitAgentError } from "../src/errors.js";

/**
 * M2-1 — integration: the public compaction helpers work end-to-end on a
 * realistic transcript + error, and the `@theokit/sdk/compaction` sub-path is
 * declared so Node ESM can resolve it.
 */

describe("compaction wiring (M2-1)", () => {
  it("test_compaction_symbols_importable_and_work", async () => {
    const transcript: CompressibleMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      buildCheckpoint("after-setup"),
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ];

    // checkpoint round-trip
    expect(filterFromLatestCheckpoint(transcript).map((m) => m.content)).toEqual(["q2", "a2"]);

    // compaction with a fake summarizer (delegation path)
    const compacted = await compactTranscript(transcript, {
      keepRecent: 1,
      summarize: async () => ({ role: "assistant", content: "SUMMARY" }),
    });
    expect(compacted[0]).toEqual({ role: "system", content: "You are helpful." });
    expect(compacted.some((m) => m.content === "SUMMARY")).toBe(true);
    expect(compacted.at(-1)?.content).toBe("a2");

    // overflow predicate on a real error
    expect(
      isContextOverflowError(new TheokitAgentError("boom", { code: "context_too_long" })),
    ).toBe(true);
    expect(isContextOverflowError(new TheokitAgentError("boom", { code: "rate_limited" }))).toBe(
      false,
    );
  });

  it("test_subpath_declared_in_package_json", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(pkg.exports["./compaction"]).toBeDefined();
  });
});
