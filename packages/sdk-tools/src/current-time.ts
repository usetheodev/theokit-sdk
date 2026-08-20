/**
 * `current_time` — built-in tool for coding agents.
 *
 * Returns the current date-time. Codex-faithful at the core (its `clock`/`curr_time` tool returns UTC
 * as `YYYY-MM-DD HH:MM:SS UTC`); this built-in keeps that default and adds an optional IANA `timezone`
 * (additive superset — omitted ⇒ UTC, exactly Codex's behavior) plus an unambiguous `iso` instant.
 *
 * The clock is injectable so the tool is deterministic under test (testing.md §6: never read the real
 * wall clock in a unit test).
 *
 * Result shape (always a JSON string):
 *   - `{ ok: true, current_time: "YYYY-MM-DD HH:MM:SS <tz>", iso: string, timezone: string }`
 *   - `{ ok: false, error: "invalid_timezone", timezone }`
 */

import type { CustomTool } from "@theokit/sdk";
import { Tool } from "@theokit/sdk";
import { z } from "zod";

export interface CreateCurrentTimeToolOptions {
  /** M76 — name exposed to the model. Omitted => today's literal (additive). The name is a contract:
   *  the approval key, what the model sees and what telemetry records. */
  name?: string;
  /** M76 — description exposed to the model. Omitted => today's literal (additive). */
  description?: string;
  /** Injectable clock — defaults to `() => new Date()`. Pass a fixed clock for deterministic tests. */
  clock?: () => Date;
}

/** Format `now` as `YYYY-MM-DD HH:MM:SS <tz>` in the given IANA timezone. Throws RangeError on a bad tz
 *  (Intl validates the zone); assembled from `formatToParts` so the layout is ICU-locale-independent. */
function formatInTimezone(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const p: Record<string, string> = {};
  for (const { type, value } of parts) p[type] = value;
  // ICU can emit "24" for midnight under hour12:false — normalize to "00".
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second} ${tz}`;
}

/**
 * Build the `current_time` tool, so the model reads a clock instead of stating a date from training
 * data.
 *
 * The model may pass an IANA `timezone`; omitted, the answer is UTC. An unknown zone comes back as
 * `{ ok: false, error: "invalid_timezone" }` — the `RangeError` `Intl` raises is caught, so the
 * handler never throws at the model.
 *
 * Pass `clock` in tests. The default reads the real wall clock, and a test asserting on a formatted
 * date without injecting one is asserting on the day it was written.
 */
export function createCurrentTimeTool(opts: CreateCurrentTimeToolOptions = {}): CustomTool {
  const clock = opts.clock ?? (() => new Date());

  return Tool.create({
    name: opts.name ?? "current_time",
    description:
      opts.description ??
      "Get the current date and time. Returns { current_time, iso, timezone } as a JSON string, where " +
        "current_time is 'YYYY-MM-DD HH:MM:SS <timezone>' and iso is the ISO-8601 instant. Pass an optional " +
        "IANA timezone (e.g. 'America/Sao_Paulo', 'Europe/Lisbon'); defaults to UTC. Never state the date " +
        "or time from memory — always call this. Returns { ok: false, error: 'invalid_timezone' } for an " +
        "unknown timezone.",
    inputSchema: z.object({
      timezone: z
        .string()
        .optional()
        .describe("IANA timezone, e.g. 'America/Sao_Paulo' or 'Europe/Lisbon'. Defaults to UTC."),
    }),
    handler: ({ timezone }) => {
      const tz = timezone ?? "UTC";
      const now = clock();
      try {
        return JSON.stringify({
          ok: true,
          current_time: formatInTimezone(now, tz),
          iso: now.toISOString(),
          timezone: tz,
        });
      } catch {
        // Fail-clear with a typed error shape (Rule 8) instead of a cryptic RangeError.
        return JSON.stringify({ ok: false, error: "invalid_timezone", timezone: tz });
      }
    },
  });
}
