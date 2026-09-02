/**
 * A created cron job reports when it will actually next fire.
 *
 * It used to report `Date.now() + 3600_000` for every expression. The function was named
 * `estimateNextRunAt`, read neither of its two parameters, and its docstring scoped it to fixture
 * mode — "real scheduling uses a proper evaluator wired in by the local scheduler". Its only call
 * site was `Cron.create()`, which is not fixture mode, so every job created carried a next-run one
 * hour out whatever its schedule said. A `@yearly` job claimed it would run within the hour.
 *
 * The scheduler overwrote the value for jobs it picked up, which is what made the fiction survive:
 * it was visible only between creating a job and the scheduler reaching it — and permanently for a
 * job the scheduler never runs.
 *
 * These cases assert the SHAPE of the answer rather than an exact timestamp, because an exact one
 * would encode the clock this suite runs on. What each one refutes is the constant: a value that
 * cannot be produced by "now plus an hour".
 */
import { describe, expect, it } from "vitest";

import { nextRunAt, normalizeExpression } from "../../../src/internal/cron/validate.js";

const HOUR = 60 * 60 * 1000;

describe("cron nextRunAt", () => {
  it("reads the expression — a yearly job is not an hour away", () => {
    const next = nextRunAt("@yearly", "UTC");
    expect(next).toBeDefined();
    // The old constant is `now + 1h`. A yearly schedule cannot land inside the next day unless today
    // happens to be Dec 31, which this bound tolerates by asking only for "further than a day".
    const isNewYearsEve = new Date().getUTCMonth() === 11 && new Date().getUTCDate() === 31;
    if (!isNewYearsEve) expect((next as number) - Date.now()).toBeGreaterThan(24 * HOUR);
  });

  it("reads the timezone — the same expression fires at different instants in different zones", () => {
    // The second parameter was ignored too. Two zones far enough apart cannot agree on when the next
    // local midnight is.
    const utc = nextRunAt("@daily", "UTC");
    const kiritimati = nextRunAt("@daily", "Pacific/Kiritimati");
    expect(utc).toBeDefined();
    expect(kiritimati).toBeDefined();
    expect(utc).not.toBe(kiritimati);
  });

  it("answers undefined when there is no next run, rather than inventing one", () => {
    // A one-shot date in the past never fires again. The old function returned now+1h for this too.
    expect(nextRunAt("0 0 1 1 *", "UTC")).toBeDefined(); // a recurring expression still answers
    expect(nextRunAt("0 0 30 2 *", "UTC")).toBeUndefined(); // 30 February never occurs
  });

  it("expands the shorthands the scheduler expands, from one definition", () => {
    // The mapping lives in validate.ts and the scheduler imports it. Two copies would let the
    // scheduler and the value stored on the job disagree about what `@weekly` means.
    expect(normalizeExpression("@hourly")).toBe("0 * * * *");
    expect(normalizeExpression("@daily")).toBe("0 0 * * *");
    expect(normalizeExpression("@weekly")).toBe("0 0 * * 0");
    expect(normalizeExpression("@monthly")).toBe("0 0 1 * *");
    expect(normalizeExpression("@yearly")).toBe("0 0 1 1 *");
    expect(normalizeExpression("*/5 * * * *"), "a POSIX expression passes through").toBe(
      "*/5 * * * *",
    );
  });
});
