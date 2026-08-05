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

import type { BudgetWindow } from "../../types/budget.js";
import { withCwdMutex } from "../persistence/cwd-mutex.js";
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

let state: LedgerState = {
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

/** Charge a budget. Idempotent across concurrent calls via withCwdMutex. */
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

/** Return total spend in the given window for `name`. Snapshot read (no mutex needed). */
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

/** Diagnostic — total logs across all budgets. */
export function __getLogCountForTests(name?: string): number {
  if (name !== undefined) return state.logs.get(name)?.length ?? 0;
  let total = 0;
  for (const arr of state.logs.values()) total += arr.length;
  return total;
}

export function __resetLedgerForTests(): void {
  state = { logs: new Map(), lastGcAt: Date.now() };
}

/** Force GC manually (tests only). */
export async function __evictNowForTests(): Promise<void> {
  await withCwdMutex(MUTEX_KEY, async () => {
    gcOlderThanOneYear(Date.now());
  });
}

/** Force-insert a log at a specific timestamp (tests only). */
export function __injectLogForTests(name: string, timestamp: number, amountUsd: number): void {
  const list = state.logs.get(name) ?? [];
  list.push({ timestamp, amountUsd });
  state.logs.set(name, list);
}
