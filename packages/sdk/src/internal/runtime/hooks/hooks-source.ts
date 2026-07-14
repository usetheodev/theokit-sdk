/**
 * Single source of truth for loading the hooks config (ADR 0016 — reverses
 * D74/D77 for hooks: JSON is canonical again, in the Claude Code shape).
 *
 * `.theokit/hooks.json` (Claude-Code-shaped JSON) is the only supported form.
 * A stray legacy `.theokit/hooks/*.md` dir (no hooks.json) is NOT loaded — it
 * warns to migrate and yields no hooks. Absent both → empty config.
 *
 * Consumed by `hooks-executor.ts` (runtime dispatch).
 *
 * Config shape (identical to Claude Code's `settings.json` hooks):
 *   { "hooks": { "PreToolUse": [ { "matcher": "shell",
 *       "hooks": [ { "type": "command", "command": "…", "timeout": 30 } ] } ] } }
 *
 * @internal
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigurationError } from "../../../errors.js";

/** The five lifecycle events the SDK runtime actually fires. */
export type HookEvent = "preRun" | "postRun" | "preToolUse" | "postToolUse" | "stop";

/**
 * Claude Code event name → the SDK firing event. Only events the runtime
 * genuinely emits are mapped; a Claude Code event with no SDK firing point
 * (SessionStart / SubagentStop / PreCompact / Notification / SessionEnd) is
 * skipped with a warn rather than silently accepted (it would never run).
 */
const CLAUDE_CODE_EVENT_MAP: Readonly<Record<string, HookEvent>> = {
  PreToolUse: "preToolUse",
  PostToolUse: "postToolUse",
  UserPromptSubmit: "preRun",
  Stop: "stop",
};

export interface HookCommand {
  command: string;
  matcher?: string;
  timeoutMs?: number;
}

export interface HookConfig {
  hooks?: Partial<Record<HookEvent, HookCommand[]>>;
}

const warned = new Set<string>();

/**
 * Emit a stderr warn once per process per unique key. Helps surface the
 * deprecation path without spamming when the loader is called many times
 * during a session (cron + send + skills all hit this).
 *
 * Note: spawned workers (cron, subagent) start fresh processes — warn
 * re-emits there, by design (1 per process boot, not per call).
 *
 * @internal
 */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  process.stderr.write(`${message}\n`);
}

/** Reset for tests; not exported via barrel. @internal */
export function _resetWarnOnceForTests(): void {
  warned.clear();
}

/**
 * Load hooks from `.theokit/hooks.json` (Claude-Code-shaped — the only supported
 * form). A stray legacy `.theokit/hooks/*.md` markdown dir (no `hooks.json`) is
 * NOT loaded — it emits a one-time migration warn and yields no hooks.
 *
 * @internal
 */
export async function loadHookConfig(cwd: string): Promise<HookConfig> {
  const jsonPath = join(cwd, ".theokit", "hooks.json");

  if (!existsSync(jsonPath)) {
    if (existsSync(join(cwd, ".theokit", "hooks"))) {
      warnOnce(
        "hooks-md-unsupported",
        "[theokit-sdk] .theokit/hooks/*.md hooks are no longer supported (ADR 0016) — migrate to a Claude-Code-shaped .theokit/hooks.json",
      );
    }
    return {};
  }

  let raw: string;
  try {
    raw = await readFile(jsonPath, "utf8");
  } catch (cause) {
    throw new ConfigurationError(`Failed to read hooks config: ${jsonPath}`, {
      code: "hooks_read_error",
      cause,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigurationError(`Invalid JSON in hooks config: ${jsonPath}`, {
      code: "hooks_json_invalid",
      cause,
    });
  }
  return parseClaudeCodeConfig(parsed, jsonPath);
}

/** Narrow an unknown to a record, or throw a typed config error. */
function asRecord(value: unknown, path: string, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigurationError(`hooks: expected an object at ${where} in ${path}`, {
      code: "hooks_json_invalid",
    });
  }
  return value as Record<string, unknown>;
}

/** Narrow an unknown to an array, or throw a typed config error. */
function asArray(value: unknown, path: string, where: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ConfigurationError(`hooks: expected an array at ${where} in ${path}`, {
      code: "hooks_json_invalid",
    });
  }
  return value;
}

/**
 * Parse Claude Code's nested hooks config into the SDK's flat internal shape:
 * `{ hooks: { PreToolUse: [{ matcher?, hooks: [{ type:"command", command, timeout? }] }] } }`
 * → `{ hooks: { preToolUse: [{ command, matcher?, timeoutMs? }] } }`. Each group's
 * `matcher` applies to every command it wraps; `timeout` (seconds) → `timeoutMs`.
 */
function parseClaudeCodeConfig(raw: unknown, path: string): HookConfig {
  const root = asRecord(raw, path, "the root");
  if (root.hooks === undefined) return {};
  const hooksRec = asRecord(root.hooks, path, `"hooks"`);
  const grouped: Partial<Record<HookEvent, HookCommand[]>> = {};

  for (const [ccEvent, groups] of Object.entries(hooksRec)) {
    const event = CLAUDE_CODE_EVENT_MAP[ccEvent];
    if (event === undefined) {
      warnOnce(
        `hooks-event-${ccEvent}`,
        `[theokit-sdk] hooks: event "${ccEvent}" is not fired by the SDK runtime (supported: ${Object.keys(CLAUDE_CODE_EVENT_MAP).join(", ")}) — skipping`,
      );
      continue;
    }
    grouped[event] = [...(grouped[event] ?? []), ...flattenEventGroups(groups, path, ccEvent)];
  }
  return { hooks: grouped };
}

/** Flatten one Claude Code event's matcher-groups into internal HookCommands. */
function flattenEventGroups(groups: unknown, path: string, ccEvent: string): HookCommand[] {
  const commands: HookCommand[] = [];
  for (const rawGroup of asArray(groups, path, `hooks.${ccEvent}`)) {
    const group = asRecord(rawGroup, path, `hooks.${ccEvent}[]`);
    const matcher = group.matcher === undefined ? undefined : String(group.matcher);
    for (const rawCmd of asArray(group.hooks, path, `hooks.${ccEvent}[].hooks`)) {
      commands.push(parseClaudeCodeCommand(rawCmd, matcher, path, ccEvent));
    }
  }
  return commands;
}

/** One `{ type:"command", command, timeout? }` entry → an internal HookCommand. */
function parseClaudeCodeCommand(
  raw: unknown,
  matcher: string | undefined,
  path: string,
  ccEvent: string,
): HookCommand {
  const cmd = asRecord(raw, path, `hooks.${ccEvent}[].hooks[]`);
  if (cmd.type !== "command") {
    throw new ConfigurationError(
      `hooks: only { "type": "command" } is supported (got ${JSON.stringify(cmd.type)}) in ${path}`,
      { code: "hooks_unsupported_type" },
    );
  }
  if (typeof cmd.command !== "string" || cmd.command.length === 0) {
    throw new ConfigurationError(`hooks: "command" must be a non-empty string in ${path}`, {
      code: "hooks_invalid_command",
    });
  }
  const hc: HookCommand = { command: cmd.command };
  if (matcher !== undefined) hc.matcher = matcher;
  if (typeof cmd.timeout === "number" && cmd.timeout > 0) {
    hc.timeoutMs = Math.round(cmd.timeout * 1000);
  }
  return hc;
}
