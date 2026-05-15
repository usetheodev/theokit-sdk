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
  if (fields.length !== 5) {
    throw new ConfigurationError(
      `Invalid cron expression: ${cron} (expected 5 fields, got ${fields.length})`,
      { code: "invalid_cron" },
    );
  }
  fields.forEach((field, index) => validateFieldOrThrow(field, index, cron));
}

function validateFieldOrThrow(field: string, index: number, cron: string): void {
  const range = FIELD_RANGES[index];
  if (range === undefined) {
    throw new ConfigurationError(`Invalid cron expression: ${cron} (field ${index + 1})`, {
      code: "invalid_cron",
    });
  }
  if (!isValidCronField(field, range)) {
    throw new ConfigurationError(`Invalid cron expression: ${cron} (field ${index + 1})`, {
      code: "invalid_cron",
    });
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

function isValidStep(stepStr: string, range: FieldRange): boolean {
  const step = Number.parseInt(stepStr, 10);
  return Number.isInteger(step) && String(step) === stepStr && step > 0 && step <= range.max;
}

function isValidRange(field: string, range: FieldRange): boolean {
  const parts = field.split("-");
  if (parts.length !== 2) return false;
  const [startStr, endStr] = parts;
  if (startStr === undefined || endStr === undefined) return false;
  const start = Number.parseInt(startStr, 10);
  const end = Number.parseInt(endStr, 10);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  return start >= range.min && end <= range.max && start <= end;
}

function isValidLiteral(field: string, range: FieldRange): boolean {
  const n = Number.parseInt(field, 10);
  return Number.isInteger(n) && String(n) === field && n >= range.min && n <= range.max;
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
 * Heuristic next-fire-at estimator for fixture mode. Returns a timestamp
 * one hour in the future for shorthand/POSIX inputs. Real scheduling uses
 * a proper evaluator wired in by the local scheduler.
 *
 * @internal
 */
export function estimateNextRunAt(_cron: string, _timezone: string): number {
  return Date.now() + 60 * 60 * 1000;
}
