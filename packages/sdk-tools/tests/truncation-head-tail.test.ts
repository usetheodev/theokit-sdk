/**
 * M77 T4.1 — `toolResultBudget`: head+tail and a machine-readable marker.
 *
 * ## Why EXTEND rather than create
 *
 * Discovery measured six output ceilings in `sdk-tools`, with **five different values** and no
 * coordination: `web-fetch.ts:26` (1 MB), `shell-exec.ts:22` (5 MB), `git-diff.ts:27` (5 MB),
 * `run-vitest.ts:36` (10 MB), `git-status.ts:35` (configurable) and this helper (30,000 B).
 *
 * And the finding that decided the design: `truncateOutput` is exported from the barrel (`index.ts:109`) and has
 * **zero production consumers** — the only use outside its own file is its test. The SDK already
 * paid for a shared truncator, nobody uses it, and every tool reimplemented its own. Creating a
 * SEVENTH would be the defect, not the fix (parsimony-ladder rung 4).
 *
 * ## What it was missing to serve as the single path
 *
 *  - **head+tail**: the cut was head-only (`truncation.ts:48`). For command output, the END usually
 *    carries what matters — the error, the summary, the prompt. Cutting only the tail discards the conclusion.
 *  - **machine-readable marker**: the signal was an English sentence injected into the middle of the text
 *    (`"[Output truncated. Full output: …]"`). Um consumidor que quisesse saber quanto foi perdido
 *    would have to parse prose. `originalBytes` solves that.
 *
 * ## What this test does NOT do
 *
 * It does not unify the six values. Consolidating the MECHANISM and unifying the LIMITS are two things:
 * 1 MB for `web-fetch` and 10 MB for `run-vitest` may differ for good reason. The plan (D2)
 * declares that explicitly out of scope for this delivery.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { truncateOutput } from "../src/truncation.js";

const outputDir = mkdtempSync(join(tmpdir(), "m77-trunc-"));
afterAll(() => rmSync(outputDir, { recursive: true, force: true }));

/** 60 numbered lines — the ends are identifiable, the middle is disposable. */
const longo = Array.from({ length: 60 }, (_, i) => `line-${String(i).padStart(2, "0")}`).join("\n");

describe("M77 T4.1 — truncamento head+tail", () => {
  it("test_head_tail_preserva_INICIO_e_FIM", () => {
    // The whole point of the mode: with head-only, `line-59` — where a command's error lives — disappears.
    const r = truncateOutput(longo, { maxBytes: 200, mode: "head-tail", outputDir });

    expect(r.truncated).toBe(true);
    expect(r.content, "the beginning must survive").toContain("line-00");
    expect(r.content, "and the END too — that is where the error lives").toContain("line-59");
    expect(r.content, "the middle is what gets discarded").not.toContain("line-30");
  });

  it("test_originalBytes_reports_the_REAL_size_and_not_the_truncated_one", () => {
    // The machine-readable marker. Without it, knowing how much was lost requires parsing the prose
    // injetada no meio do texto.
    const r = truncateOutput(longo, { maxBytes: 200, mode: "head-tail", outputDir });

    expect(r.originalBytes).toBe(Buffer.byteLength(longo, "utf-8"));
    expect(
      r.originalBytes,
      "must be LARGER than the ceiling, otherwise no truncation happened",
    ).toBeGreaterThan(200);
  });

  it("test_modo_head_continua_o_DEFAULT", () => {
    // Backward compatibility: the helper is exported from the public barrel. Changing the default silently
    // would change the output of any future consumer that had already adopted the old mode.
    const noMode = truncateOutput(longo, { maxBytes: 200, outputDir });
    const comHead = truncateOutput(longo, { maxBytes: 200, mode: "head", outputDir });

    // Compare the SEGMENT, not the whole string: the trailer carries the `overflowPath`, which is now
    // deliberately unique per call (the collision fix just below). The first version
    // of this test did a `toBe` on the full content and started failing because of the fix itself —
    // the oracle was measuring the file name, not the cutting mode.
    const trecho = (s: string): string => s.split("\n\n[Output truncated")[0] ?? "";
    expect(trecho(noMode.content)).toBe(trecho(comHead.content));
    expect(noMode.content, "the default cuts the tail, as it always did").not.toContain("line-59");
  });

  it("test_COUNTERPROOF_short_output_is_not_truncated_in_any_mode", () => {
    // Without this, an implementation that ALWAYS truncated would pass the tests above. And `originalBytes`
    // must be present even on the happy path — a field that only appears on failure forces the
    // consumer to test for `undefined`, which is the doorway to a magic value.
    const curto = "abc";
    for (const mode of ["head", "head-tail"] as const) {
      const r = truncateOutput(curto, { maxBytes: 100, mode, outputDir });
      expect(r.truncated).toBe(false);
      expect(r.content).toBe(curto);
      expect(r.originalBytes).toBe(3);
    }
  });

  it("test_exactly_at_the_limit_does_NOT_truncate", () => {
    // The `<=` from `truncation.ts:37` (EC-3 of the original design). Preserved — a `<` would make every output
    // an exactly-sized output become an overflow file.
    const r = truncateOutput("abc", { maxBytes: 3, mode: "head-tail", outputDir });
    expect(r.truncated).toBe(false);
  });

  it("test_two_truncations_in_the_SAME_ms_do_not_collide_on_the_overflow_file", () => {
    // A real bug found by M77 itself, not an invented scenario: the name was
    // `overflow-${Date.now()}.txt`, so two truncations within the same millisecond resolved
    // to the SAME path and the second silently overwrote the first. The `overflowPath`
    // returned to the caller then pointed at someone else's output — a wrong answer, not an error.
    //
    // It surfaced as an intermittent failure when running two truncation suites together; the cause was in
    // production code, not in the test. `rules/testing.md` § 3: a flake is a bug.
    const a = truncateOutput(`${longo}-A`, { maxBytes: 100, outputDir });
    const b = truncateOutput(`${longo}-B`, { maxBytes: 100, outputDir });

    expect(a.overflowPath).not.toBe(b.overflowPath);
  });

  it("test_head_tail_with_a_tiny_ceiling_does_not_produce_corrupt_utf8", () => {
    // Edge: the cut is by BYTE, and an odd ceiling in the middle of a multibyte character would split the code
    // point. `Buffer.toString` substituiria por U+FFFD, e o modelo leria lixo.
    const accented = "\u00e1\u00e9\u00ed\u00f3\u00fa".repeat(40);
    const r = truncateOutput(accented, { maxBytes: 9, mode: "head-tail", outputDir });

    expect(r.truncated).toBe(true);
    expect(
      r.content,
      "no replacement character — the cut respects the code point boundary",
    ).not.toContain("�");
  });
});
