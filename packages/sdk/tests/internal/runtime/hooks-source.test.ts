/**
 * Tests for loadHookConfig — Claude-Code-shaped `.theokit/hooks.json` is
 * canonical; the legacy `.theokit/hooks/*.md` markdown format is a deprecated
 * fallback. (Reverses ADR D74/D77 for hooks — see ADR 0016.)
 *
 * Claude Code config shape:
 *   { "hooks": { "PreToolUse": [ { "matcher": "shell",
 *       "hooks": [ { "type": "command", "command": "…", "timeout": 30 } ] } ] } }
 *
 * The loader maps Claude Code event names to the 5 events the SDK runtime fires
 * (PreToolUse→preToolUse, PostToolUse→postToolUse, UserPromptSubmit→preRun,
 * Stop→stop), flattens each group's `hooks[]` (applying the group `matcher`),
 * and converts `timeout` seconds → internal `timeoutMs`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetWarnOnceForTests,
  loadHookConfig,
} from "../../../src/internal/runtime/hooks/hooks-source.js";

let dir: string;
const stderrCapture: string[] = [];
let origWrite: typeof process.stderr.write;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hooks-src-"));
  stderrCapture.length = 0;
  origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrCapture.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  }) as typeof process.stderr.write;
  _resetWarnOnceForTests();
});

afterEach(() => {
  process.stderr.write = origWrite;
  rmSync(dir, { recursive: true, force: true });
});

function writeJson(content: unknown): void {
  mkdirSync(join(dir, ".theokit"), { recursive: true });
  writeFileSync(join(dir, ".theokit", "hooks.json"), JSON.stringify(content), "utf8");
}

/** Writes the raw text at `.theokit/hooks.json` — used for malformed-JSON cases writeJson can't produce. */
function writeRawJson(text: string): void {
  mkdirSync(join(dir, ".theokit"), { recursive: true });
  writeFileSync(join(dir, ".theokit", "hooks.json"), text, "utf8");
}

function writeMd(slug: string, frontmatter: Record<string, unknown>): void {
  mkdirSync(join(dir, ".theokit", "hooks"), { recursive: true });
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) lines.push(`${k}: ${String(v)}`);
  lines.push("---");
  writeFileSync(join(dir, ".theokit", "hooks", `${slug}.md`), lines.join("\n"), "utf8");
}

describe("loadHookConfig — Claude-Code JSON (canonical)", () => {
  it("returns {} when no config exists", async () => {
    expect(await loadHookConfig(dir)).toEqual({});
  });

  it("loads the Claude-Code nested shape without warning", async () => {
    writeJson({
      hooks: {
        PreToolUse: [
          {
            matcher: "shell",
            hooks: [{ type: "command", command: "node policy.js", timeout: 30 }],
          },
        ],
      },
    });
    const config = await loadHookConfig(dir);
    // mapped to the internal `preToolUse` event
    expect(config.hooks?.preToolUse).toHaveLength(1);
    expect(config.hooks?.preToolUse?.[0]?.command).toBe("node policy.js");
    expect(config.hooks?.preToolUse?.[0]?.matcher).toBe("shell");
    // timeout seconds → internal ms
    expect(config.hooks?.preToolUse?.[0]?.timeoutMs).toBe(30_000);
    expect(stderrCapture.join("")).not.toContain("deprecated");
  });

  it("maps every Claude-Code event name to the SDK firing event", async () => {
    writeJson({
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "echo pre" }] }],
        PostToolUse: [{ hooks: [{ type: "command", command: "echo post" }] }],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo prompt" }] }],
        Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
      },
    });
    const config = await loadHookConfig(dir);
    expect(config.hooks?.preToolUse?.[0]?.command).toBe("echo pre");
    expect(config.hooks?.postToolUse?.[0]?.command).toBe("echo post");
    expect(config.hooks?.preRun?.[0]?.command).toBe("echo prompt"); // UserPromptSubmit → preRun
    expect(config.hooks?.stop?.[0]?.command).toBe("echo stop");
  });

  it("flattens multiple groups + multiple commands under one event, group matcher applied to each", async () => {
    writeJson({
      hooks: {
        PreToolUse: [
          {
            matcher: "shell",
            hooks: [
              { type: "command", command: "echo a" },
              { type: "command", command: "echo b" },
            ],
          },
          { matcher: "write_file", hooks: [{ type: "command", command: "echo c" }] },
        ],
      },
    });
    const config = await loadHookConfig(dir);
    expect(config.hooks?.preToolUse).toHaveLength(3);
    expect(config.hooks?.preToolUse?.map((h) => [h.command, h.matcher])).toEqual([
      ["echo a", "shell"],
      ["echo b", "shell"],
      ["echo c", "write_file"],
    ]);
  });

  it("skips a Claude-Code event the SDK runtime does not fire (e.g. PreCompact) with a warn", async () => {
    writeJson({
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "echo ok" }] }],
        PreCompact: [{ hooks: [{ type: "command", command: "echo nope" }] }],
      },
    });
    const config = await loadHookConfig(dir);
    expect(config.hooks?.preToolUse).toHaveLength(1);
    // PreCompact is not one of the SDK's firing events — dropped, warned, never crashes.
    expect(Object.keys(config.hooks ?? {})).not.toContain("PreCompact");
    expect(stderrCapture.join("")).toContain("PreCompact");
  });

  it("a non-command hook type is rejected with a typed ConfigurationError", async () => {
    writeJson({
      hooks: { PreToolUse: [{ hooks: [{ type: "webhook", command: "x" }] }] },
    });
    await expect(loadHookConfig(dir)).rejects.toMatchObject({
      name: "ConfigurationError",
      code: "hooks_unsupported_type",
      message: expect.stringContaining('only { "type": "command" } is supported'),
    });
  });

  it("test_an_empty_command_string_is_rejected_as_a_typed_configuration_error", async () => {
    writeJson({
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "" }] }] },
    });
    await expect(loadHookConfig(dir)).rejects.toMatchObject({
      name: "ConfigurationError",
      code: "hooks_invalid_command",
      message: expect.stringContaining('"command" must be a non-empty string'),
    });
  });

  it("test_a_missing_command_field_is_rejected_the_same_way_as_an_empty_one", async () => {
    writeJson({
      hooks: { PreToolUse: [{ hooks: [{ type: "command" }] }] },
    });
    await expect(loadHookConfig(dir)).rejects.toMatchObject({
      name: "ConfigurationError",
      code: "hooks_invalid_command",
    });
  });

  it("test_an_unreadable_hooks_json_fails_with_a_typed_read_error_not_a_raw_fs_error", async () => {
    // existsSync(jsonPath) is true (a directory sits there), but readFile on a
    // directory fails with EISDIR — this is the read-failure branch, distinct
    // from "file absent" (empty config) and "malformed JSON" (parse branch).
    mkdirSync(join(dir, ".theokit", "hooks.json"), { recursive: true });
    await expect(loadHookConfig(dir)).rejects.toMatchObject({
      name: "ConfigurationError",
      code: "hooks_read_error",
      message: expect.stringContaining("Failed to read hooks config"),
    });
  });

  it("test_malformed_json_text_is_rejected_as_a_typed_parse_error", async () => {
    writeRawJson("{ not valid json,,,");
    await expect(loadHookConfig(dir)).rejects.toMatchObject({
      name: "ConfigurationError",
      code: "hooks_json_invalid",
      message: expect.stringContaining("Invalid JSON in hooks config"),
    });
  });

  it("test_a_non_object_json_root_is_rejected_as_a_typed_shape_error", async () => {
    writeRawJson(JSON.stringify(["not", "an", "object"]));
    await expect(loadHookConfig(dir)).rejects.toMatchObject({
      name: "ConfigurationError",
      code: "hooks_json_invalid",
      message: expect.stringContaining("expected an object at the root"),
    });
  });

  it("test_a_non_array_event_group_is_rejected_as_a_typed_shape_error", async () => {
    writeJson({ hooks: { PreToolUse: "not-an-array" } });
    await expect(loadHookConfig(dir)).rejects.toMatchObject({
      name: "ConfigurationError",
      code: "hooks_json_invalid",
      message: expect.stringContaining("expected an array at hooks.PreToolUse"),
    });
  });
});

describe("loadHookConfig — markdown (unsupported, ADR 0016)", () => {
  it("does NOT load a legacy .theokit/hooks/<name>.md; warns to migrate", async () => {
    writeMd("shell-policy", { event: "preToolUse", matcher: "^shell$", command: "node policy.js" });
    const config = await loadHookConfig(dir);
    expect(config).toEqual({});
    expect(stderrCapture.join("")).toContain("no longer supported");
  });

  it("uses hooks.json and ignores a stray markdown dir", async () => {
    writeJson({
      hooks: {
        PreToolUse: [{ matcher: "json", hooks: [{ type: "command", command: "echo json" }] }],
      },
    });
    writeMd("md-hook", { event: "preToolUse", matcher: "md", command: "echo md" });
    const config = await loadHookConfig(dir);
    expect(config.hooks?.preToolUse?.[0]?.command).toBe("echo json");
    // No markdown load happens when hooks.json exists — no warn about it.
    expect(stderrCapture.join("")).not.toContain("no longer supported");
  });
});
