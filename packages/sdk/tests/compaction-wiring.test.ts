import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildCheckpoint,
  type CompressibleMessage,
  compactTranscript,
  estimateTokens,
  filterFromLatestCheckpoint,
  isContextOverflowError,
  SUMMARY_TEMPLATE,
  shouldCompact,
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

    // M2-2 pre-call helpers importable from the same subpath
    expect(typeof estimateTokens).toBe("function");
    expect(typeof shouldCompact).toBe("function");
    expect(estimateTokens("1234")).toBe(1);
    expect(shouldCompact({ estimated: 9000, contextWindow: 10_000, buffer: 1000 })).toBe(true);
  });

  it("test_summary_template_exported_from_subpath", () => {
    // V3-3: SUMMARY_TEMPLATE is a new public export on the @theokit/sdk/compaction subpath.
    expect(typeof SUMMARY_TEMPLATE).toBe("string");
    for (const h of ["Goal", "Constraints", "Progress", "Decisions", "Next", "Critical", "Files"]) {
      expect(SUMMARY_TEMPLATE).toContain(`## ${h}`);
    }
  });

  it("test_subpath_declared_in_package_json", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(pkg.exports["./compaction"]).toBeDefined();
  });
});
