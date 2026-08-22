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

import type { BudgetWindow } from "@theokit/sdk";

/**
 * Midnight UTC of `now`'s day — the start of a `1d` budget window.
 *
 * Always UTC, never the host's local timezone: "1 USD per day" resets at 00:00Z, so a budget in
 * UTC-05:00 resets at 19:00 local. That is deliberate — a budget shared by processes in different
 * regions must reset at one instant — but it surprises anyone reading a daily total at local
 * midnight.
 */
export function startOfDayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Midnight UTC on the MONDAY of `now`'s week — the start of a `1w` budget window.
 *
 * ISO 8601, so the week starts on Monday, not Sunday. This is calendar-aligned rather than rolling:
 * "5 USD per week" resets on Monday, which is what a person reading a weekly budget expects, and not
 * a trailing 168 hours. `30d` and `365d` are relative for the mirror-image reason — nobody expects a
 * monthly budget to reset on the 1st.
 */
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

/**
 * Inclusive start timestamp (ms) of `window`, as `spentIn` uses it to decide which charges count.
 *
 * Two different behaviours behind one enum, and the difference is visible in every total:
 *
 * - `1d` / `1w` are CALENDAR-aligned to UTC (midnight; ISO Monday). Spend resets at a boundary.
 * - `1h` / `30d` / `365d` are ROLLING — `now` minus the duration. Nothing ever "resets"; the
 *   oldest charges simply fall out of the window.
 *
 * Throws on a value outside `BudgetWindow`, which TypeScript already prevents.
 */
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
