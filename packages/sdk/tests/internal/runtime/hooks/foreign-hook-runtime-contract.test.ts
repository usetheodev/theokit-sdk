import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import { HooksExecutor } from "../../../../src/internal/runtime/hooks/hooks-executor.js";
import { removeTempDirRobustSync } from "../../../helpers/temp-workspace.js";

/**
 * usetheokit/theokit-sdk#522 — every turn was denied in any repository that also uses Claude Code.
 *
 * Reading `.claude/settings.json` is a deliberate compatibility decision. The commands in that file
 * are written for Claude Code's runtime, which defines `$CLAUDE_PROJECT_DIR` for them. This SDK did
 * not, so `sh` expanded the unset variable to the empty string and
 *
 *     bash "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.sh"   ->   bash "/.claude/hooks/guard.sh"
 *
 * failed with `No such file or directory`, which the hook runner correctly reads as a refusal. Every
 * tool call denied, in a repository whose only unusual property was having Claude Code set up.
 *
 * Three properties made it expensive: it fails CLOSED, so nothing degrades gracefully; the message
 * named the missing FILE while the script was present and executable, so the reader looked in the
 * wrong place; and it needed no configuration of this SDK at all.
 *
 * Importing a format means accepting the contract that format presumes. That is what these pin.
 */
function claudeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "theokit-522-"));
  onTestFinished(() => {
    removeTempDirRobustSync(dir);
  });
  mkdirSync(join(dir, ".claude", "hooks"), { recursive: true });
  return dir;
}

/** A hook written the way Claude Code documents: a project file reached through the variable. */
function writeClaudeHook(dir: string, script: string): void {
  writeFileSync(
    join(dir, ".claude", "settings.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { type: "command", command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.sh"' },
            ],
          },
        ],
      },
    }),
  );
  writeFileSync(join(dir, ".claude", "hooks", "guard.sh"), script, { mode: 0o755 });
}

describe("a hook imported from .claude gets the runtime contract that format presumes", () => {
  it("runs a hook that reaches a project file through $CLAUDE_PROJECT_DIR", async () => {
    const dir = claudeProject();
    writeClaudeHook(dir, "#!/usr/bin/env bash\nexit 0\n");

    const hooks = new HooksExecutor(dir);
    await hooks.initialize(true);
    const decision = await hooks.run({ event: "preToolUse", tool: "shell", input: {} });

    expect(
      decision.blocked,
      `the hook was denied: ${decision.reason ?? "(no reason)"} — the script exists and is ` +
        "executable, so a denial here means the variable it is reached through was never defined",
    ).toBe(false);
  });

  it("passes the workspace root, not merely a defined-but-wrong value", async () => {
    // The variable existing is not the claim; the variable naming THIS workspace is. A hook that
    // resolves it and finds the wrong tree would pass the assertion above while being broken.
    const dir = claudeProject();
    writeClaudeHook(
      dir,
      '#!/usr/bin/env bash\n[ -d "$CLAUDE_PROJECT_DIR/.claude/hooks" ] || exit 3\nexit 0\n',
    );

    const hooks = new HooksExecutor(dir);
    await hooks.initialize(true);
    const decision = await hooks.run({ event: "preToolUse", tool: "shell", input: {} });

    expect(decision.blocked, decision.reason ?? "").toBe(false);
  });

  it("names the VARIABLE when a foreign command needs one nobody defines", async () => {
    // The other half of #522, and the half that cost the debugging session. The original failure
    // read `/.claude/hooks/…: No such file or directory` — which says the script is missing, while
    // the script was present and executable. The reader goes looking for a file that is right
    // there, because nothing in the output contains the word CLAUDE_PROJECT_DIR.
    //
    // `CLAUDE_PLUGIN_ROOT` is the realistic case now: it belongs to the same foreign runtime, this
    // SDK deliberately does NOT invent a value for it (an invented root sends a script somewhere
    // real and wrong), so a command using it must fail SAYING SO.
    const dir = claudeProject();
    writeFileSync(
      join(dir, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ type: "command", command: 'bash "$CLAUDE_PLUGIN_ROOT/hooks/guard.sh"' }] },
          ],
        },
      }),
    );

    const hooks = new HooksExecutor(dir);
    await hooks.initialize(true);
    const decision = await hooks.run({ event: "preToolUse", tool: "shell", input: {} });

    expect(decision.blocked).toBe(true);
    expect(
      decision.reason,
      "the denial must name the variable — a message about a missing FILE sends the reader to a " +
        "path that is not the problem",
    ).toContain("CLAUDE_PLUGIN_ROOT");
  });

  it("says nothing about variables the environment does define", async () => {
    // The counter-proof against a diagnostic that fires on every `$VAR`. `$HOME` is set in any
    // process this runs in, so a command using it must behave exactly as before.
    const dir = claudeProject();
    writeFileSync(
      join(dir, ".claude", "settings.json"),
      JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [{ type: "command", command: 'test -d "$HOME"' }] }] },
      }),
    );

    const hooks = new HooksExecutor(dir);
    await hooks.initialize(true);
    const decision = await hooks.run({ event: "preToolUse", tool: "shell", input: {} });

    expect(decision.blocked, decision.reason ?? "").toBe(false);
  });

  it("still denies a hook that genuinely fails — the contract is not a bypass", async () => {
    // The counter-proof. Defining the variable must not turn the hook runner permissive: a script
    // that exits non-zero is still a refusal, and that is the whole point of a PreToolUse hook.
    const dir = claudeProject();
    writeClaudeHook(dir, "#!/usr/bin/env bash\necho 'policy says no' >&2\nexit 1\n");

    const hooks = new HooksExecutor(dir);
    await hooks.initialize(true);
    const decision = await hooks.run({ event: "preToolUse", tool: "shell", input: {} });

    expect(decision.blocked).toBe(true);
    expect(decision.reason).toContain("policy says no");
  });
});
