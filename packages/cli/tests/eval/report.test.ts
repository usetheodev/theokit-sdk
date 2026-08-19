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
