import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";

import { setDiagnosticsSink } from "../../../../src/internal/diagnostics.js";
import { reportUndeclaredSources } from "../../../../src/internal/runtime/compat/foreign-config-sources.js";
import { removeTempDirRobustSync } from "../../../helpers/temp-workspace.js";

/**
 * usetheokit/theokit-sdk#524, second half — the default flipped, and a flip nobody can SEE is how a
 * fix becomes the next bug report.
 *
 * Before #524 a `.claude/` was read with no opt-in. After it, the same directory is ignored. From
 * inside the repository both states look identical: the file is there, it is executable, and it is
 * not running. Without a word from the SDK the only way to learn the reason is to read a CHANGELOG
 * entry for a version you did not know you upgraded past.
 *
 * ## Why `diag` and not `diagFailure`
 *
 * `diagFailure` falls back to stderr, and this is not a failure: ignoring an undeclared foreign
 * directory is the whole intent of #524. Every repository that has Claude Code set up and does NOT
 * want it imported would pay a line on stderr at every agent start — in a TUI host, on the render
 * surface — for behaving exactly as asked. That is the corruption `diagnostics.ts` exists to stop.
 *
 * So it goes on the interceptable channel, once per (workspace, dialect), for whoever is holding
 * the question this message answers: "why did my hook stop running?"
 */
function capture(): string[] {
  const lines: string[] = [];
  setDiagnosticsSink((m) => {
    lines.push(m);
  });
  return lines;
}

function workspaceWith(dir: string): string {
  const root = mkdtempSync(join(tmpdir(), "theokit-524-warn-"));
  onTestFinished(() => {
    removeTempDirRobustSync(root);
  });
  mkdirSync(join(root, dir), { recursive: true });
  return root;
}

afterEach(() => {
  setDiagnosticsSink(undefined);
});

describe("an undeclared foreign directory is reported, not silently skipped", () => {
  it("names the directory, what it governs, and the line that turns it back on", () => {
    const lines = capture();

    reportUndeclaredSources(workspaceWith(".claude"), []);

    const message = lines.join("");
    expect(message).toContain(".claude");
    expect(message, "the reader must learn what stopped, not just that something did").toMatch(
      /hooks|skills|subagents|plugins/,
    );
    expect(message, "a warning without the remedy is a riddle").toContain("claude-code");
  });

  it("says nothing when the source is declared", () => {
    const lines = capture();

    reportUndeclaredSources(workspaceWith(".claude"), ["claude-code"]);

    expect(lines).toEqual([]);
  });

  it("says nothing when the directory is not there", () => {
    const lines = capture();

    reportUndeclaredSources(workspaceWith(".theokit"), []);

    expect(lines).toEqual([]);
  });

  it("reports once per workspace, however many agents start in it", () => {
    const lines = capture();
    const root = workspaceWith(".claude");

    reportUndeclaredSources(root, []);
    reportUndeclaredSources(root, []);
    reportUndeclaredSources(root, []);

    expect(lines).toHaveLength(1);
  });
});
