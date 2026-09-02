/**
 * B-052 — every rejection branch of the cron validator was untested, and the only suite that
 * asserted any of them (`tests/contract/cron-validation-matrix.contract.test.ts`) sits in the
 * directory `vitest.config.ts:84` excludes from the default gate.
 *
 * Measured before writing this file, over the cron + router slice of the default gate (56 files /
 * 425 tests, all green), with `--coverage.include='src/internal/cron/validate.ts'`:
 *
 *   DA:34,0    empty / non-string expression
 *   DA:40,0    unknown `@shorthand`
 *   DA:49,0    wrong field count
 *   DA:62,0    field index outside FIELD_RANGES — stays 0, and cannot move: `:48` has already
 *              rejected anything without exactly 5 fields and `FIELD_RANGES` has exactly 5 entries,
 *              so `range === undefined` is unreachable. Filed separately as dead code, same family
 *              as B-097; not removed here because that is a production change outside this dod.
 *   DA:67,0    malformed or out-of-range field
 *   DA:114,0   invalid IANA timezone
 *   DA:76-101,0  the list / range / literal field validators — never entered at all
 *
 * A validator whose accept path is tested and whose reject paths are not is testing the least
 * interesting half: nothing would have gone red if the parser started accepting `"* * * *"` or
 * `"Not/AZone"`. The reverse holds too (`testing.md` § 4.2) — a validator asserted only on refusals
 * cannot tell a correct predicate from one that rejects everything, which fails closed and reads to
 * users as "cron is broken". Both directions are asserted here.
 *
 * Every negative case names the `code`, not only the class: `ConfigurationError` is thrown from over
 * a hundred sites in `src/` and has subclasses, so the class alone does not identify which guard
 * fired.
 */

import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import { validateCronExpression, validateTimezone } from "../../../src/internal/cron/validate.js";
import { expectPublicError } from "../../helpers/assert-public-error.js";

/**
 * Runs a validator that is expected to refuse, and hands back the error for assertion.
 *
 * Fails loudly when the input was ACCEPTED — that is the regression these tests exist to catch, and
 * a silently-passing `expect` on an error that never happened would hide it.
 */
function refusalOf(run: () => void, label: string): ConfigurationError {
  try {
    run();
  } catch (err) {
    return err as ConfigurationError;
  }
  throw new Error(`expected ${label} to be refused, but the validator accepted it`);
}

function cronRefusal(cron: unknown): ConfigurationError {
  return refusalOf(
    () => validateCronExpression(cron as string),
    `cron expression ${JSON.stringify(cron)}`,
  );
}

describe("validateCronExpression — refusals", () => {
  it("test_an_empty_expression_is_refused_as_invalid_cron", () => {
    const err = cronRefusal("");

    expectPublicError(err, {
      ctor: ConfigurationError,
      code: "invalid_cron",
    });
    expect(err.message).toContain("empty");
  });

  it("test_a_non_string_expression_is_refused_as_invalid_cron", () => {
    // The other clause of the same guard. A cron read from JSON or a config file can arrive as a
    // number or `undefined`; the boundary refuses it rather than letting `.startsWith` explode.
    const err = cronRefusal(undefined);

    expectPublicError(err, {
      ctor: ConfigurationError,
      code: "invalid_cron",
    });
  });

  it("test_an_unknown_shorthand_is_refused", () => {
    const err = cronRefusal("@sometimes");

    expectPublicError(err, {
      ctor: ConfigurationError,
      code: "invalid_cron",
    });
    expect(err.message, "the message must name the shorthand the user typed").toContain(
      "@sometimes",
    );
  });

  it("test_an_expression_with_too_few_fields_is_refused", () => {
    const err = cronRefusal("* * *");

    expectPublicError(err, {
      ctor: ConfigurationError,
      code: "invalid_cron",
    });
    expect(err.message).toContain("expected 5 fields, got 3");
  });

  it("test_an_expression_with_too_many_fields_is_refused", () => {
    // The seconds-resolution cron of other schedulers. Accepting it silently would shift every
    // field by one and fire the job at a wildly different time.
    const err = cronRefusal("0 * * * * *");

    expectPublicError(err, {
      ctor: ConfigurationError,
      code: "invalid_cron",
    });
    expect(err.message).toContain("expected 5 fields, got 6");
  });

  it.each([
    ["a minute above 59", "60 * * * *", 1],
    ["an hour above 23", "0 24 * * *", 2],
    ["a day-of-month below 1", "* * 0 * *", 3],
    ["a month above 12", "* * * 13 *", 4],
    ["a day-of-week above 6", "* * * * 7", 5],
    ["a non-numeric literal", "abc * * * *", 1],
    ["a zero step", "*/0 * * * *", 1],
    ["a step above the field maximum", "*/99 * * * *", 1],
    ["a reversed range", "5-2 * * * *", 1],
    ["a malformed range", "1-2-3 * * * *", 1],
    ["a list with an out-of-range member", "1,99 * * * *", 1],
    // The prefix-parse family. `Number.parseInt` stops at the first non-digit, so WITHOUT the
    // `String(n) === field` / `String(step) === stepStr` round-trip in `isValidLiteral` /
    // `isValidStep` every row below parses to a number in range and is accepted as a valid cron.
    // Measured: dropping the round-trip from `validate.ts:101` leaves the other 37 tests green —
    // the classic hole in a numeric validator, and this file was leaving it open.
    ["a literal with a trailing suffix", "5abc * * * *", 1],
    ["a decimal literal", "5.9 * * * *", 1],
    ["a literal in exponent notation", "1e1 * * * *", 1],
    ["a signed literal", "+5 * * * *", 1],
    ["a hexadecimal literal", "0x5 * * * *", 1],
    ["a step with a trailing suffix", "*/5abc * * * *", 1],
    // B-121 — the same prefix-parse hole, in the one field shape B-052 left asymmetric.
    // `isValidRange` called `Number.parseInt` WITHOUT the round-trip its two siblings had, so a
    // suffix refused as a literal was accepted inside a range. Measured 2026-08-19 against croner
    // 9 (the engine that actually runs these jobs): it refuses both with "contains illegal
    // character", so accepting them here only moved the failure from `Cron.create()` to fire time.
    ["a range whose end carries a trailing suffix", "1-5abc * * * *", 1],
    ["a range whose start carries a trailing suffix", "1abc-5 * * * *", 1],
    ["a range member in exponent notation", "1-1e1 * * * *", 1],
    ["a range member in hexadecimal", "0x1-5 * * * *", 1],
  ])("test_%s_is_refused_and_the_message_names_the_field", (_label, cron, fieldNumber) => {
    const err = cronRefusal(cron);

    expectPublicError(err, {
      ctor: ConfigurationError,
      code: "invalid_cron",
    });
    expect(err.message, "the message must point at the offending field").toContain(
      `(field ${fieldNumber})`,
    );
  });
});

describe("validateCronExpression — the expressions it must accept", () => {
  // `testing.md` § 4.2: a guard tested only on what it rejects cannot distinguish a correct
  // predicate from one that rejects everything. These rows are the other half of the oracle.
  it.each([
    "@hourly",
    "@daily",
    "@weekly",
    "@monthly",
    "@yearly",
  ])("test_the_documented_shorthand_%s_is_accepted", (cron) => {
    expect(() => validateCronExpression(cron)).not.toThrow();
  });

  it.each([
    ["every minute", "* * * * *"],
    ["a step", "*/15 * * * *"],
    ["literals in every field", "0 0 1 1 *"],
    ["a day-of-week literal", "30 9 * * 1"],
    ["a list", "1,15,30 * * * *"],
    ["a range", "0 9-17 * * *"],
    ["a list of ranges", "0-5,55-59 * * * *"],
    ["the upper bound of every field", "59 23 31 12 6"],
    ["the lower bound of every field", "0 0 1 1 0"],
    ["surrounding and repeated whitespace", "  0   0 * * *  "],
    // B-122 — zero-padding. The `String(n) === field` round-trip B-052 added to reject `"5abc"`
    // also rejected `"07"`, and the two cases were never separated. Measured 2026-08-19: croner 9,
    // the engine this SDK schedules with, ACCEPTS `"07 * * * *"` and fires it at :07. Refusing it
    // at the boundary rejected a schedule the runtime runs correctly, which is a validator being
    // wrong in the direction that reads to users as "cron is broken".
    ["a zero-padded literal", "07 * * * *"],
    ["a zero-padded range", "01-05 * * * *"],
    ["a zero-padded step", "*/05 * * * *"],
    ["a zero-padded list", "01,02 * * * *"],
    ["a zero-padded field at its upper bound", "059 023 031 012 006"],
  ])("test_%s_is_accepted", (_label, cron) => {
    expect(() => validateCronExpression(cron)).not.toThrow();
  });
});

describe("validateTimezone", () => {
  it("test_an_unknown_zone_is_refused_as_invalid_timezone", () => {
    const err = refusalOf(() => validateTimezone("Not/AZone"), "timezone Not/AZone");

    expect(err).toBeInstanceOf(ConfigurationError);
    // A DIFFERENT code from the cron guard: a job with a good expression and a typo'd zone must be
    // diagnosable as such, which a shared `invalid_cron` would prevent.
    expect(err.code).toBe("invalid_timezone");
    expect(err.message).toContain("Not/AZone");
  });

  it("test_an_empty_zone_is_refused", () => {
    const err = refusalOf(() => validateTimezone(""), "the empty timezone");

    expectPublicError(err, {
      ctor: ConfigurationError,
      code: "invalid_timezone",
    });
  });

  it.each([
    "UTC",
    "America/Sao_Paulo",
    "Asia/Tokyo",
    "Europe/London",
  ])("test_the_real_IANA_zone_%s_is_accepted", (zone) => {
    expect(() => validateTimezone(zone)).not.toThrow();
  });
});
