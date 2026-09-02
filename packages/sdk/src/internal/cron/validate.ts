import { Cron } from "croner";
import { ConfigurationError } from "../../errors.js";

/**
 * POSIX-cron + shorthand validators used by `Cron.create()`. Throws
 * `ConfigurationError` with a stable message and code on invalid input.
 *
 * @internal
 */

const SHORTHANDS = new Set(["@hourly", "@daily", "@weekly", "@monthly", "@yearly"]);

interface FieldRange {
  min: number;
  max: number;
}

const FIELD_RANGES: readonly FieldRange[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day-of-month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 }, // day-of-week
];

/**
 * Validate a cron expression. Accepts shorthand (`@hourly`, ..., `@yearly`)
 * or 5-field POSIX cron with star, literals, star/N step, N-M range, and
 * N,M,P list.
 *
 * @internal
 */
export function validateCronExpression(cron: string): void {
  if (typeof cron !== "string" || cron.length === 0) {
    throw new ConfigurationError("Invalid cron expression: empty", {
      code: "invalid_cron",
    });
  }
  if (cron.startsWith("@")) {
    if (!SHORTHANDS.has(cron)) {
      throw new ConfigurationError(`Invalid cron expression: unknown shorthand ${cron}`, {
        code: "invalid_cron",
      });
    }
    return;
  }

  const fields = cron.trim().split(/\s+/);
  if (fields.length !== FIELD_RANGES.length) {
    throw new ConfigurationError(
      `Invalid cron expression: ${cron} (expected ${FIELD_RANGES.length} fields, got ${fields.length})`,
      { code: "invalid_cron" },
    );
  }
  for (const [index, range] of FIELD_RANGES.entries()) {
    // The length check above already established one field per range, so the lookup is total.
    // B-116: this replaces a `range === undefined` guard that no caller could reach — its single
    // caller only ran with exactly 5 fields, and FIELD_RANGES has exactly 5 entries, so the branch
    // stayed at 0 executions through 37 tests written specifically to enter it.
    const field = fields[index] as string;
    if (!isValidCronField(field, range)) {
      throw new ConfigurationError(`Invalid cron expression: ${cron} (field ${index + 1})`, {
        code: "invalid_cron",
      });
    }
  }
}

function isValidCronField(field: string, range: FieldRange): boolean {
  if (field === "*") return true;
  if (field.startsWith("*/")) return isValidStep(field.slice(2), range);
  if (field.includes(",")) {
    return field.split(",").every((part) => isValidCronField(part, range));
  }
  if (field.includes("-")) return isValidRange(field, range);
  return isValidLiteral(field, range);
}

/**
 * Digits, and nothing else. `Number.parseInt` stops at the first non-digit, so it reads `"5abc"` as
 * `5` and `"0x5"` as `0` — a numeric field parsed that way accepts garbage that happens to start
 * with a digit.
 *
 * This replaces the `String(n) === field` round-trip the literal and step validators used to carry.
 * The round-trip refused the garbage correctly but also refused `"07"`, because `String(7) !== "07"`
 * — and `isValidRange` never had it at all, so `"1-5abc"` was accepted while `"5abc"` was refused
 * (B-121). One predicate, applied to every field shape, closes both halves.
 *
 * The boundary that matters is croner 9, the scheduler this SDK actually fires jobs with. Measured
 * 2026-08-19: it ACCEPTS `"07 * * * *"` (next run at :07) and REFUSES `"5abc"`, `"1-5abc"`,
 * `"1abc-5"`, `"0x5"`, `"5.9"`, `"+5"` and `"1e1"` as "illegal character" (B-122). Validating
 * stricter than the engine rejects schedules that would have run; validating looser only moves the
 * failure from `Cron.create()` to fire time, where nobody is watching.
 *
 * @internal
 */
const DIGITS_ONLY = /^\d+$/;

function parseFieldNumber(text: string): number | undefined {
  if (!DIGITS_ONLY.test(text)) return undefined;
  return Number.parseInt(text, 10);
}

function isValidStep(stepStr: string, range: FieldRange): boolean {
  const step = parseFieldNumber(stepStr);
  return step !== undefined && step > 0 && step <= range.max;
}

function isValidRange(field: string, range: FieldRange): boolean {
  const parts = field.split("-");
  if (parts.length !== 2) return false;
  const [startStr, endStr] = parts;
  if (startStr === undefined || endStr === undefined) return false;
  const start = parseFieldNumber(startStr);
  const end = parseFieldNumber(endStr);
  if (start === undefined || end === undefined) return false;
  return start >= range.min && end <= range.max && start <= end;
}

function isValidLiteral(field: string, range: FieldRange): boolean {
  const n = parseFieldNumber(field);
  return n !== undefined && n >= range.min && n <= range.max;
}

/**
 * Validate an IANA timezone. Uses `Intl.DateTimeFormat`'s strict timezone
 * lookup; invalid values raise `RangeError` which we wrap.
 *
 * @internal
 */
export function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new ConfigurationError(`Invalid IANA timezone: ${timezone}`, {
      code: "invalid_timezone",
    });
  }
}

/**
 * Shorthand (`@daily`, …) to the POSIX five-field form Croner parses.
 *
 * Moved here from the scheduler: interpreting a cron expression is this module's subject, and
 * {@link nextRunAt} needs the same mapping. Two copies would let the scheduler and the value stored
 * on the job disagree about what `@weekly` means.
 *
 * @internal
 */
export function normalizeExpression(cron: string): string {
  switch (cron) {
    case "@hourly":
      return "0 * * * *";
    case "@daily":
      return "0 0 * * *";
    case "@weekly":
      return "0 0 * * 0";
    case "@monthly":
      return "0 0 1 * *";
    case "@yearly":
      return "0 0 1 1 *";
    default:
      return cron;
  }
}

/**
 * When this expression next fires, or `undefined` when it never does again.
 *
 * This used to be `estimateNextRunAt`, which read neither of its parameters and returned
 * `Date.now() + 3600_000` for every input. Its docstring scoped it to fixture mode — "real scheduling
 * uses a proper evaluator wired in by the local scheduler" — and its one call site was
 * `Cron.create()`, so EVERY job created carried a `nextRunAt` one hour out whatever its schedule
 * said. A `@yearly` job reported that it would run in an hour. The scheduler corrected the value
 * later for jobs it picked up, so the fiction was visible exactly in the window between creating a
 * job and the scheduler reaching it — and permanently for a job the scheduler never runs.
 *
 * Croner is already a dependency and already computes this in the scheduler; this is the same call.
 * `undefined` rather than a filled-in number when there is no next run: `CronJob.nextRunAt` is
 * optional, and an absent next run is a real state (a one-shot date in the past), not a zero.
 *
 * @internal
 */
export function nextRunAt(cron: string, timezone: string): number | undefined {
  return new Cron(normalizeExpression(cron), { timezone }).nextRun()?.getTime();
}
