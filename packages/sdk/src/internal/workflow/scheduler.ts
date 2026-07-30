/**
 * WorkflowScheduler — cron-based trigger for evented workflows (T11.2, ADR D451).
 *
 * Wraps `croner` (already a dep) with dispose semantics (EC-3).
 *
 * @internal
 */

import { Cron } from "croner";
import { diag } from "../diagnostics.js";

export interface WorkflowSchedulerOptions {
  schedule: string;
  handler: () => Promise<void>;
}

export class WorkflowScheduler {
  private _cron: Cron | null = null;
  private readonly _schedule: string;
  private readonly _handler: () => Promise<void>;
  private _disposed = false;

  constructor(opts: WorkflowSchedulerOptions) {
    this._schedule = opts.schedule;
    this._handler = opts.handler;
  }

  get isRunning(): boolean {
    return this._cron?.isRunning() ?? false;
  }

  start(): void {
    if (this._disposed) return;
    if (this._cron !== null) return;
    this._cron = new Cron(this._schedule, { paused: false }, async () => {
      try {
        await this._handler();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        diag(`[theokit-sdk] WorkflowScheduler error: ${msg}\n`);
      }
    });
  }

  stop(): void {
    this._cron?.stop();
    this._cron = null;
  }

  dispose(): void {
    this.stop();
    this._disposed = true;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
