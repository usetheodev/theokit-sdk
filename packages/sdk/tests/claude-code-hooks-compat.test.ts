import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadHookConfig } from "../src/internal/runtime/hooks/hooks-source.js";

/*
 * Hook configuration under `.claude`.
 *
 * The format already agreed: `.theokit/hooks.json` is documented as "identical to Claude Code's
 * settings.json hooks" and was verified so on 2026-08-26. Only the location did not.
 *
 * Sources are MERGED rather than resolved to one winner. Hooks are unnamed lists, not named
 * declarations: two files defining `PreToolUse` are two sets of commands an operator wrote, and
 * taking only one silently drops the other — the same silent-gate class the loaders guard against
 * elsewhere. A named thing (an agent, a skill) collides and the first wins; an unnamed list does not
 * collide, it accumulates.
 *
 * Known limitation, not a defect: `SessionStart` and `PreCompact` have no firing point in this
 * runtime, so they are skipped with a warn. Four of the CLI's events map (`PreToolUse`,
 * `PostToolUse`, `UserPromptSubmit`, `Stop`).
 */
describe("hooks declared under .claude", () => {
  let cwd: string;

  const writeHooks = (root: string, command: string): void => {
    mkdirSync(join(cwd, root), { recursive: true });
    writeFileSync(
      join(cwd, root, "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "shell", hooks: [{ type: "command", command }] }],
        },
      }),
    );
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cc-hooks-compat-"));
  });

  it("test_a_hooks_file_under_dot_claude_is_loaded", async () => {
    writeHooks(".claude", "echo do-claude");
    const config = await loadHookConfig(cwd);
    expect(JSON.stringify(config)).toContain("echo do-claude");
  });

  it("test_hooks_from_both_files_all_run_rather_than_one_silently_losing", async () => {
    writeHooks(".theokit", "echo do-theokit");
    writeHooks(".claude", "echo do-claude");
    const config = await loadHookConfig(cwd);
    expect(JSON.stringify(config)).toContain("echo do-theokit");
    expect(JSON.stringify(config)).toContain("echo do-claude");
  });

  it("test_hooks_written_in_the_cli_settings_file_are_loaded", async () => {
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "settings.json"),
      JSON.stringify({
        permissions: { allow: [] },
        hooks: {
          PreToolUse: [{ hooks: [{ type: "command", command: "echo from-settings" }] }],
        },
      }),
    );
    const config = await loadHookConfig(cwd);
    expect(JSON.stringify(config)).toContain("echo from-settings");
  });

  it("test_a_personal_settings_override_is_loaded_beside_the_shared_one", async () => {
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    for (const [file, cmd] of [
      ["settings.json", "echo shared"],
      ["settings.local.json", "echo personal"],
    ] as const) {
      writeFileSync(
        join(cwd, ".claude", file),
        JSON.stringify({
          hooks: { Stop: [{ hooks: [{ type: "command", command: cmd }] }] },
        }),
      );
    }
    const config = await loadHookConfig(cwd);
    expect(JSON.stringify(config)).toContain("echo shared");
    expect(JSON.stringify(config)).toContain("echo personal");
  });

  it("test_a_settings_file_carrying_no_hooks_block_contributes_nothing_and_does_not_fail", async () => {
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash"] }, env: { A: "1" } }),
    );
    expect(await loadHookConfig(cwd)).toEqual({});
  });

  // The accepted case (rules/testing.md § 4.2): a project with neither must still load cleanly,
  // or "no hooks" would have become an error rather than an empty config.
  it("test_a_project_with_no_hooks_file_anywhere_loads_an_empty_config", async () => {
    expect(await loadHookConfig(cwd)).toEqual({});
  });
});
