/**
 * UTC-aligned calendar window helpers (ADR D382).
 *
 * - `1h` — relative (now - 1 hour).
 * - `1d` — UTC midnight (current UTC day).
 * - `1w` — UTC monday 00:00:00 (current UTC week, Monday is week start).
 * - `30d` — relative 30 days.
 * - `365d` — relative 365 days.
 *
 * `1d` and `1w` are calendar-aligned because users expect "1 USD per day"
 * = "since midnight UTC", not a rolling 24h.
 * `30d`/`365d` are relative because nobody expects "since the 1st".
 *
 * @internal
 */

import type { BudgetWindow } from "../../types/budget.js";

export function startOfDayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function startOfWeekUtc(now: Date = new Date()): Date {
  // ISO 8601 week starts on Monday. getUTCDay() returns 0 (Sun) .. 6 (Sat).
  const dayOfWeek = now.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7; // Mon=0, Sun=6
  const start = startOfDayUtc(now);
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Returns the inclusive start timestamp (ms) for the given window relative to `now`. */
export function windowStartMs(window: BudgetWindow, now: Date = new Date()): number {
  switch (window) {
    case "1h":
      return now.getTime() - MS_PER_HOUR;
    case "1d":
      return startOfDayUtc(now).getTime();
    case "1w":
      return startOfWeekUtc(now).getTime();
    case "30d":
      return now.getTime() - 30 * MS_PER_DAY;
    case "365d":
      return now.getTime() - 365 * MS_PER_DAY;
    default: {
      const _exhaustive: never = window;
      throw new Error(`unreachable window: ${_exhaustive as string}`);
    }
  }
}
