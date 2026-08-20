/**
 * T5.1 — `formatReport` is the only thing a `theokit eval` run leaves behind:
 * the markdown file a human reads to decide whether a prompt change helped.
 *
 * Measured before this file existed (lcov, `packages/cli`, tests/dev +
 * tests/eval + tests/commands): `src/eval/report.ts` 0/26 lines, 0/12
 * branches, all four functions `FNDA:0`. Genuinely zero — nothing in the
 * suite reached it, not even indirectly.
 *
 * The behaviours worth protecting are the ones whose failure is silent: a
 * number rendered at the wrong precision, a pipe in a model answer that
 * shears the markdown table apart, and an errored row that reads as a
 * successful one.
 */

import { describe, expect, it } from "vitest";

import { formatReport } from "../../src/eval/report.js";
import type { EvalRowResult, EvalRunResult } from "../../src/eval/types.js";

type Aggregate = EvalRunResult["aggregate"];

function makeRow(overrides: Partial<EvalRowResult> = {}): EvalRowResult {
  return {
    input: "what is 2+2?",
    output: "4",
    scores: [{ name: "exact", score: 1 }],
    meanScore: 1,
    ...overrides,
  };
}

function makeResult(
  rows: readonly EvalRowResult[],
  aggregate: Partial<Aggregate> = {},
): EvalRunResult {
  return {
    rows,
    aggregate: {
      meanScore: 1,
      passRatio: 1,
      totalRows: rows.length,
      errorRows: 0,
      ...aggregate,
    },
  };
}

/**
 * True when `s` contains no unpaired surrogate — i.e. every code unit in D800-DBFF is followed by
 * one in DC00-DFFF, and vice versa.
 *
 * `String.prototype.isWellFormed` answers exactly this and exists on Node 22, but it is typed under
 * `lib: es2024` and this package targets lower. Raising the whole package's lib for one test helper
 * changes typing everywhere to fix it in one place, so the predicate is spelled out here instead.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
function isWellFormed(s: string): boolean {
  return !LONE_SURROGATE.test(s);
}

/** The data rows of the markdown table, excluding header and separator. */
function dataRows(report: string): string[] {
  return report.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| # |"));
}

describe("formatReport — aggregate header", () => {
  it("renders the mean score at three decimals", () => {
    const report = formatReport(makeResult([], { meanScore: 0.666_66 }));

    expect(report).toContain("- **Mean score:** 0.667");
  });

  it("renders the pass ratio as a one-decimal percentage", () => {
    const report = formatReport(makeResult([], { passRatio: 0.333_33 }));

    expect(report).toContain("- **Pass ratio (≥0.5):** 33.3%");
  });

  it("reports the row totals it was given rather than recounting them", () => {
    const report = formatReport(makeResult([makeRow()], { totalRows: 42, errorRows: 7 }));

    expect(report).toContain("- **Total rows:** 42");
    expect(report).toContain("- **Error rows:** 7");
  });

  it("emits the table header and no data rows for an empty run", () => {
    const report = formatReport(makeResult([]));

    expect(report).toContain("| # | Input | Output | Mean | Scores | Notes |");
    expect(dataRows(report)).toEqual([]);
  });

  it("terminates the report with a newline", () => {
    expect(formatReport(makeResult([]))).toMatch(/\n$/);
  });
});

describe("formatReport — per-row rendering", () => {
  it("numbers the rows from one, in order", () => {
    const report = formatReport(
      makeResult([
        makeRow({ input: "first" }),
        makeRow({ input: "second" }),
        makeRow({ input: "third" }),
      ]),
    );

    const rows = dataRows(report);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("| 1 | first |");
    expect(rows[1]).toContain("| 2 | second |");
    expect(rows[2]).toContain("| 3 | third |");
  });

  it("renders the row mean at three decimals", () => {
    const report = formatReport(makeResult([makeRow({ meanScore: 0.5 })]));

    expect(dataRows(report)[0]).toContain("| 0.500 |");
  });

  it("renders a successful row's output verbatim with empty notes", () => {
    const report = formatReport(makeResult([makeRow({ output: "the answer is 4" })]));

    expect(dataRows(report)[0]).toBe(
      "| 1 | what is 2+2? | the answer is 4 | 1.000 | exact=1.00 |  |",
    );
  });
});

describe("formatReport — scores column", () => {
  it("renders a score as name=value at two decimals", () => {
    const report = formatReport(makeResult([makeRow({ scores: [{ name: "bleu", score: 0.5 }] })]));

    expect(dataRows(report)[0]).toContain("| bleu=0.50 |");
  });

  it("appends the reason in parentheses when the scorer gave one", () => {
    const report = formatReport(
      makeResult([makeRow({ scores: [{ name: "judge", score: 0, reason: "off topic" }] })]),
    );

    expect(dataRows(report)[0]).toContain("| judge=0.00 (off topic) |");
  });

  it("omits the parenthetical when the scorer gave no reason", () => {
    const report = formatReport(makeResult([makeRow({ scores: [{ name: "judge", score: 0 }] })]));

    expect(dataRows(report)[0]).toContain("| judge=0.00 |");
    expect(dataRows(report)[0]).not.toContain("(");
  });

  it("separates multiple scores with a semicolon", () => {
    const report = formatReport(
      makeResult([
        makeRow({
          scores: [
            { name: "exact", score: 1 },
            { name: "judge", score: 0.25, reason: "partial" },
          ],
        }),
      ]),
    );

    expect(dataRows(report)[0]).toContain("| exact=1.00; judge=0.25 (partial) |");
  });

  it("renders an em dash when the row produced no scores at all", () => {
    const report = formatReport(makeResult([makeRow({ scores: [] })]));

    expect(dataRows(report)[0]).toContain("| — |");
  });
});

describe("formatReport — errored rows", () => {
  it("replaces the output of an errored row with the *error* marker", () => {
    const report = formatReport(
      makeResult([makeRow({ output: "half a response", error: "provider timeout" })]),
    );

    const row = dataRows(report)[0] ?? "";
    expect(row).toContain("| *error* |");
    expect(row).not.toContain("half a response");
  });

  it("puts the error message in the notes column", () => {
    const report = formatReport(makeResult([makeRow({ error: "provider timeout" })]));

    expect(dataRows(report)[0]).toContain("| provider timeout |");
  });

  it("leaves the notes column empty for a row that did not error", () => {
    const report = formatReport(makeResult([makeRow()]));

    expect(dataRows(report)[0]).toMatch(/\|\s*\|$/);
  });
});

describe("formatReport — markdown escaping", () => {
  it("escapes a pipe in the output so the cell cannot break the table", () => {
    const report = formatReport(makeResult([makeRow({ output: "a | b" })]));

    const row = dataRows(report)[0] ?? "";
    expect(row).toContain("a \\| b");
    // The row still has exactly the six cells the header declares.
    expect(row.split(" | ")).toHaveLength(6);
  });

  it("escapes a pipe in the input", () => {
    const report = formatReport(makeResult([makeRow({ input: "a|b" })]));

    expect(dataRows(report)[0]).toContain("a\\|b");
  });

  it("escapes a pipe inside a score reason", () => {
    const report = formatReport(
      makeResult([makeRow({ scores: [{ name: "judge", score: 1, reason: "yes|no" }] })]),
    );

    expect(dataRows(report)[0]).toContain("(yes\\|no)");
  });

  it("escapes a pipe inside an error message", () => {
    const report = formatReport(makeResult([makeRow({ error: "bad|input" })]));

    expect(dataRows(report)[0]).toContain("bad\\|input");
  });

  it("flattens a newline in the output to a space so the row stays on one line", () => {
    const report = formatReport(makeResult([makeRow({ output: "line one\nline two" })]));

    expect(dataRows(report)).toHaveLength(1);
    expect(dataRows(report)[0]).toContain("line one line two");
  });

  it("leaves ordinary text untouched", () => {
    // § 4.2 — the accepting direction. An escaper that mangled every cell
    // would satisfy every rejection case above and still corrupt the report.
    const report = formatReport(
      makeResult([makeRow({ input: "plain text", output: "plain out" })]),
    );

    expect(dataRows(report)[0]).toContain("| plain text | plain out |");
  });
});

describe("formatReport — truncation", () => {
  it("keeps an input of exactly 60 characters intact", () => {
    const input = "x".repeat(60);

    const report = formatReport(makeResult([makeRow({ input })]));

    expect(dataRows(report)[0]).toContain(`| ${input} |`);
    expect(report).not.toContain("…");
  });

  it("truncates a 61-character input to 59 characters plus an ellipsis", () => {
    const report = formatReport(makeResult([makeRow({ input: "x".repeat(61) })]));

    expect(dataRows(report)[0]).toContain(`| ${"x".repeat(59)}… |`);
  });

  it("keeps an output of exactly 80 characters intact", () => {
    const output = "y".repeat(80);

    const report = formatReport(makeResult([makeRow({ output })]));

    expect(dataRows(report)[0]).toContain(`| ${output} |`);
  });

  it("truncates the output at 80, not at the input's 60", () => {
    const report = formatReport(makeResult([makeRow({ output: "y".repeat(81) })]));

    expect(dataRows(report)[0]).toContain(`| ${"y".repeat(79)}… |`);
  });
});

describe("formatReport — sparse rows", () => {
  it("skips a hole in the rows array instead of throwing, and keeps the surviving numbering", () => {
    // `rows[i]` is `EvalRowResult | undefined` under noUncheckedIndexedAccess;
    // the `row === undefined` guard is what stops a hole from crashing the
    // whole report. Deleting the guard turns this case into a TypeError.
    const sparse: EvalRowResult[] = [];
    sparse[0] = makeRow({ input: "first" });
    sparse[2] = makeRow({ input: "third" });

    const report = formatReport(makeResult(sparse));

    const rows = dataRows(report);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("| 1 | first |");
    expect(rows[1]).toContain("| 3 | third |");
  });
});

describe("formatReport — truncation and Unicode (#342)", () => {
  it("does not leave a lone surrogate when an emoji straddles the input cut", () => {
    // Arrange — 31 glyphs is 62 UTF-16 code units, past the 60-unit input budget, and the
    // cut at 59 lands between the halves of the 30th emoji.
    const input = "\u{1F600}".repeat(31);

    // Act
    const report = formatReport(makeResult([makeRow({ input })]));

    // Assert — `isWellFormed` is exactly this question: does the string contain a surrogate
    // without its pair? A lone surrogate is not a Unicode scalar value, so it has no UTF-8
    // encoding; a writer downstream either substitutes U+FFFD or rejects the file.
    expect(isWellFormed(report)).toBe(true);
  });

  it("does not leave a lone surrogate when an emoji straddles the output cut", () => {
    // Arrange — the output budget is 80 code units, so 41 glyphs (82 units) straddles it.
    const output = "\u{1F600}".repeat(41);

    // Act
    const report = formatReport(makeResult([makeRow({ output })]));

    // Assert
    expect(isWellFormed(report)).toBe(true);
  });

  it("truncates on whole characters, so the cell is shorter in units than the budget", () => {
    // Arrange
    const input = "\u{1F600}".repeat(31);

    // Act
    const cell = dataRows(formatReport(makeResult([makeRow({ input })])))[0] ?? "";

    // Assert — the point is not the exact length but that a whole emoji was dropped rather
    // than halved: 29 glyphs (58 units) plus the ellipsis, never 29.5.
    expect(cell).toContain("…");
    expect(isWellFormed(cell)).toBe(true);
    expect([...cell].every((ch) => ch !== "\uD83D")).toBe(true);
  });

  it("leaves a string already inside the budget untouched", () => {
    // Arrange — 3 glyphs, 6 code units, far below 60.
    const input = "\u{1F600}\u{1F600}\u{1F600}";

    // Act
    const cell = dataRows(formatReport(makeResult([makeRow({ input })])))[0] ?? "";

    // Assert — the accepted case. Without it, a truncate() that returned "…" for every
    // input would pass every assertion above.
    expect(cell).toContain(input);
    expect(cell).not.toContain("…");
  });
});

describe("formatReport — truncation is a prefix (#342)", () => {
  it("stops at the first character that does not fit instead of skipping it", () => {
    // Arrange — 29 emoji (58 units) fill the budget to 58 of 59; the 30th emoji needs 2 more
    // and does not fit, but the trailing "ab" would. A truncation that SKIPPED the emoji and
    // took "ab" would still be well-formed and still be short enough — and would silently
    // reorder the text, which is what makes this worth pinning separately.
    const input = `${"\u{1F600}".repeat(30)}ab`;

    // Act — the INPUT cell only. Asserting over the whole row is the wrong instrument: it also
    // carries `exact=1.00`, so a naive `not.toContain("a")` fails on the scorer's name rather
    // than on the truncation, and reads as the defect it was meant to catch.
    const row = dataRows(formatReport(makeResult([makeRow({ input })])))[0] ?? "";
    const inputCell = row.split(" | ")[1] ?? "";

    // Assert — the result must be a PREFIX of the original: no character from beyond the cut
    // may appear. `a`/`b` live only after the emoji that did not fit.
    expect(inputCell).not.toContain("a");
    expect(inputCell).not.toContain("b");
    expect(isWellFormed(inputCell)).toBe(true);
  });
});

describe("isWellFormed — the oracle the truncation tests rest on", () => {
  // Without these, a helper that always returned `true` would satisfy every surrogate
  // assertion in this file, and the tests above would be measuring nothing. The rejecting
  // cases prove it fires; the accepting ones prove it is not simply refusing everything
  // (rules/testing.md § 4.2).
  it("rejects a lone high surrogate, including the exact shape the old truncate produced", () => {
    expect(isWellFormed("\uD83D")).toBe(false);
    expect(isWellFormed("\uD83D…")).toBe(false);
    expect(isWellFormed(`${"\u{1F600}"}\uD83D…`)).toBe(false);
  });

  it("rejects a lone low surrogate", () => {
    expect(isWellFormed("\uDE00")).toBe(false);
    expect(isWellFormed("a\uDE00b")).toBe(false);
  });

  it("accepts well-formed text, whether or not it contains astral characters", () => {
    expect(isWellFormed("hello")).toBe(true);
    expect(isWellFormed("\u{1F600}")).toBe(true);
    expect(isWellFormed("😀")).toBe(true);
    expect(isWellFormed("")).toBe(true);
  });
});
