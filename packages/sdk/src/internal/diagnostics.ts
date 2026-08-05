/**
 * The library's single diagnostics channel — silent by default (#147).
 *
 * ## O problema
 *
 * The SDK wrote diagnostics straight to `process.stderr` from hot paths — 92 sites across 51
 * files under `internal/`. In a TUI host (Ink, alternate screen), those writes interleave with the
 * render and **corrupt the frame**. And the host had no way to intercept them: there was no
 * injectable logger. One consumer went as far as installing `proper-lockfile` just to silence ONE
 * of them.
 *
 * A library cannot assume `stdout`/`stderr` are free sinks. The application owns the terminal, not
 * the dependency.
 *
 * ## O contrato
 *
 * - **`setDiagnosticsSink(fn)`** hands the messages to the application, which decides where to put
 *   them (a status line, a file, a panel). It is what was missing for a TUI to coexist with the SDK.
 * - **With no sink, it goes to `stderr`** — exactly as before this change.
 *
 * ## Why the default did NOT change (yet), and why that is deliberate
 *
 * #147 asks for silence by default, and that is the right target. But **58 test files** currently
 * assert these diagnostics reach `stderr` — they encode the contract "the warning IS emitted",
 * which still holds and must not be lost. Flipping the default without migrating them would fail
 * ~53 tests, and migrating them in a hurry, across four different ways of spying on `stderr`, is
 * the recipe for weakening 58 suites at once.
 *
 * So this change delivers the half that UNBLOCKS the consumer — a TUI host can now
 * interceptar, que era o bloqueio relatado ("no way to intercept these; no injectable logger") — e
 * and leaves flipping the default as its own migration, with a measured cost. A host that wants silence
 * hoje instala `setDiagnosticsSink(() => {})`.
 *
 * ## Coverage is the whole guarantee
 *
 * The first sweep migrated the 92 sites under `internal/` and left `src/`'s own modules —
 * `event-bus.ts`, `batch.ts`, `compaction.ts`, `internal/workflow/step-branch.ts`. A host could
 * therefore install a sink and still have its frame corrupted by a batch run, which is the reported
 * defect with a smaller blast radius. Those are routed here too, and
 * `tests/lint/no-direct-terminal-write.test.ts` is what keeps the next hot path from
 * reintroducing one. "Mostly interceptable" is not interceptable.
 *
 * The remaining direct writers are allowlisted there with a reason, and every one of them is a seam
 * whose destination the CALLER already chooses (`opts.warn`, `opts.logger`, the Workflow logger).
 *
 * ## What this is NOT
 *
 * It is not a logger with levels, formatting or multiple destinations. It is the minimum that
 * resolves the reported blocker; a full logger here would be inventing a requirement nobody asked
 * for.
 */

/** Receives each diagnostic message already formatted, with the trailing `\n`. */
export type DiagnosticsSink = (message: string) => void;

let sink: DiagnosticsSink | undefined;

/**
 * Installs (or removes, by passing `undefined`) the diagnostics destination.
 *
 * When a sink is present it is the ONLY destination — `stderr` gets no copy. Duplicating
 * destinations would hand the problem back to the TUI that installed the sink precisely to get the
 * messages out of the terminal.
 */
export function setDiagnosticsSink(next: DiagnosticsSink | undefined): void {
  sink = next;
}

/**
 * Emits a library diagnostic message.
 *
 * Replaces `process.stderr.write` on internal paths. Never throws: a faulty sink must not
 * must not take down the run it merely observes.
 */
export function diag(message: string): void {
  if (sink !== undefined) {
    try {
      sink(message);
    } catch {
      // Observability never breaks the run — same principle as `emitRunEvent`.
    }
    return;
  }
  process.stderr.write(message);
}
