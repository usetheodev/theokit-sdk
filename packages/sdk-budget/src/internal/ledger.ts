/**
 * In-process Budget ledger (ADR D385).
 *
 * Singleton mutex-protected. Stores per-budget ChargeLog[] arrays;
 * `spentIn(window)` filters by timestamp.
 *
 * EC-6: GC eviction runs INSIDE the same mutex as charge — no race.
 * EC-9: charge() is called inside the same critical section as preflight
 * check by Budget enforcement.
 *
 * Persistence cross-restart: deferred to v0.2 (JsonFile pattern).
 *
 * @internal
 */

import { type BudgetWindow, withCwdMutex } from "@theokit/sdk";
import { windowStartMs } from "./calendar-window.js";

interface ChargeLog {
  timestamp: number;
  amountUsd: number;
}

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;
const GC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const GC_LOGS_THRESHOLD = 10_000;

interface LedgerState {
  readonly logs: Map<string, ChargeLog[]>;
  lastGcAt: number;
}

const state: LedgerState = {
  logs: new Map(),
  lastGcAt: Date.now(),
};

const MUTEX_KEY = "budget-ledger";

function shouldGc(now: number): boolean {
  if (now - state.lastGcAt < GC_INTERVAL_MS) return false;
  let totalLogs = 0;
  for (const arr of state.logs.values()) totalLogs += arr.length;
  return totalLogs > GC_LOGS_THRESHOLD;
}

function gcOlderThanOneYear(now: number): void {
  const cutoff = now - MS_PER_YEAR;
  for (const [name, arr] of state.logs.entries()) {
    const kept = arr.filter((l) => l.timestamp >= cutoff);
    if (kept.length === 0) state.logs.delete(name);
    else state.logs.set(name, kept);
  }
  state.lastGcAt = now;
}

/**
 * Append `amountUsd` to the spend ledger for the budget called `name`, timestamped now.
 *
 * NOT idempotent. `withCwdMutex` SERIALIZES concurrent calls so two appends cannot interleave; it
 * does not deduplicate them. Calling this twice with the same arguments records the spend twice,
 * and there is no charge id to reconcile against — an at-least-once caller needs its own guard.
 *
 * NOT VALIDATED against the registry either: charging a name that was never passed to
 * `createBudget` (a typo, say) succeeds silently and accumulates spend that no limit enforces and
 * that `snapshotAll` — which iterates the REGISTRY — will never show.
 *
 * `chargeAndCheckThresholds` does not rescue you from that, and swapping to it trades one silent
 * failure for another: on an unknown or already-deleted name it writes one line to stderr and
 * RETURNS WITHOUT CHARGING, so the spend is lost rather than merely invisible. Neither function
 * throws. Validate the name against `getBudgetOptionsRaw` / `getBudget` if it matters which of the
 * two failures you get.
 *
 * `amountUsd <= 0` is a no-op, so a refund cannot be expressed here.
 *
 * The ledger is a MODULE-LEVEL SINGLETON: process-wide, shared by every budget and every agent in
 * the process, and lost on exit — there is no persistence across restarts. Entries older than a
 * year are garbage-collected opportunistically.
 */
export async function charge(name: string, amountUsd: number): Promise<void> {
  if (amountUsd <= 0) return;
  await withCwdMutex(MUTEX_KEY, async () => {
    const now = Date.now();
    const list = state.logs.get(name) ?? [];
    list.push({ timestamp: now, amountUsd });
    state.logs.set(name, list);
    if (shouldGc(now)) gcOlderThanOneYear(now);
  });
}

/**
 * Total USD recorded for `name` inside `window`, summed at call time.
 *
 * Returns `0` for a name that was never charged — indistinguishable from a budget that exists and
 * has spent nothing. Use `getBudget(name)` when you need to tell those apart.
 *
 * Lock-free: it reads the live array without taking the mutex, so a charge landing mid-read is
 * simply included or not. Window boundaries are those of {@link windowStartMs} — `1d` and `1w` are
 * UTC calendar-aligned, the rest are rolling.
 */
export function spentIn(name: string, window: BudgetWindow, now: Date = new Date()): number {
  const arr = state.logs.get(name);
  if (arr === undefined) return 0;
  const sinceMs = windowStartMs(window, now);
  let total = 0;
  for (const log of arr) {
    if (log.timestamp >= sinceMs) total += log.amountUsd;
  }
  return total;
}
