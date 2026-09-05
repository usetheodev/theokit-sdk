/**
 * #563 — the warning for an undeclared foreign config directory must reach the person who did
 * not know their `.claude/` stopped being read.
 *
 * `5.0.0` made `.claude/` opt-in (#524). The CHANGELOG says the workspace "says so once, on the
 * diagnostics channel". Measured against the published `5.0.0`: it does not say so to anyone.
 * `diag()` returns without doing anything when no sink is installed, the SDK never installs one,
 * and neither of the two observable hosts does either — `theocode` renamed the key, and `theokit`
 * exports `installDiagnosticSink` and never calls it. So a consumer upgrading 4.63.4 -> 5.0.0
 * loses hooks, skills, subagents and plugins in silence, along with the line that reverses it.
 *
 * The original docblock chose `diag` deliberately, and its reasoning was sound: a repository that
 * has Claude Code set up and does NOT want it imported should not pay a stderr line for behaving
 * as instructed. That cost is real and it is not free here — this change makes them pay it.
 *
 * What makes the trade defensible, stated rather than hidden:
 *
 *   - the line is emitted ONCE per directory per process (`reported`), not per turn;
 *   - a repository that does not want the import was, before #524, having it imported anyway, so
 *     the line it now sees is confirmation of the fix it wanted;
 *   - the loss on the other side is hooks, skills, subagents and plugins, silently.
 *
 * There is NO opt-out yet, and that is a real gap. `compatSources: []` would be the natural way to
 * say "I know, and I want none", but `resolveCompatSources` collapses it into the same `[]` an
 * absent option produces, so the two cannot be told apart at this layer. Threading that distinction
 * through is a separate change; if the noise turns out to matter, that is the shape of the fix.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDiagnosticsSink } from "../src/internal/diagnostics.js";
import { reportUndeclaredSources } from "../src/internal/runtime/compat/foreign-config-sources.js";

/** A fresh cwd per test: the warning dedupes per directory, in module state that outlives a test. */
let cwd: string;
let stderr: ReturnType<typeof vi.spyOn>;

function withClaudeDir(): string {
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  return cwd;
}

function stderrText(): string {
  return stderr.mock.calls.map((c: readonly unknown[]) => String(c[0])).join("");
}

describe("#563 — an undeclared .claude/ tells the consumer, with or without a sink", () => {
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "theokit-563-"));
    setDiagnosticsSink(undefined);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
    setDiagnosticsSink(undefined);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("reaches stderr when no sink is installed", () => {
    reportUndeclaredSources(withClaudeDir(), []);

    // The whole defect: with no sink, `diag` swallowed this and the consumer learned nothing.
    expect(stderrText(), "the undeclared-directory warning must not depend on a sink").toContain(
      ".claude/ is present but not declared",
    );
  });

  it("names the line that restores the previous behaviour", () => {
    reportUndeclaredSources(withClaudeDir(), []);

    // A warning that reports a loss without naming the fix makes the reader search the CHANGELOG
    // of a version they may not know they crossed.
    expect(stderrText()).toContain('compatSources: ["claude-code"]');
  });

  it("names the FILE, which is the entry point its reader can actually use", () => {
    reportUndeclaredSources(withClaudeDir(), []);

    // #524 gives the declaration two entry points for one shape: `.theokit/config.json`'s
    // `compat.adapters`, and `local.compatSources` in code. The first version of this warning
    // named only the second — and `local` is an argument the SDK's EMBEDDER passes, not something
    // the person reading the line can reach.
    //
    // Reported by the `theocode` session against 5.0.1, running as a host that embeds this SDK:
    // its users were told to pass an option that does not exist on their surface. True about the
    // mechanism, unusable as an action.
    //
    // Asserting BOTH halves, because dropping the code option would break the embedder for whom
    // it is the right answer. The defect was naming one of the two, not naming the wrong one.
    const out = stderrText();
    expect(
      out,
      "the file entry point is missing, so a non-embedding reader has no action",
    ).toContain('{"compat":{"adapters":["claude-code"]}}');
    expect(out, "the file the reader must edit is not named").toContain(".theokit/config.json");
  });

  it("still prefers an installed sink, and does not also write to stderr", () => {
    const seen: string[] = [];
    setDiagnosticsSink((m) => seen.push(m));

    reportUndeclaredSources(withClaudeDir(), []);

    expect(seen.join("")).toContain(".claude/ is present but not declared");
    expect(stderrText(), "a host that intercepts diagnostics keeps owning its render surface").toBe(
      "",
    );
  });

  it("says nothing when the source was declared", () => {
    reportUndeclaredSources(withClaudeDir(), ["claude-code"]);

    expect(stderrText()).toBe("");
  });

  it("says nothing when there is no .claude/ at all", () => {
    reportUndeclaredSources(cwd, []);

    expect(stderrText()).toBe("");
  });
});
