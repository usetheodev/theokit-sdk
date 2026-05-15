import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigurationError } from "../../errors.js";
import { spawnAndCollect } from "./spawn-collect.js";

/**
 * Real file-based hook executor. Reads `.theokit/hooks.json` from the
 * workspace, spawns the configured command for each event with a JSON
 * payload on stdin, and aggregates the decisions.
 *
 * Decisions are conservative by design:
 *   - Non-zero exit code on a `preRun` / `preToolUse` hook fails the
 *     attached operation with `HookDeniedError`-style data.
 *   - JSON-shaped stdout (e.g. `{"decision":"deny","reason":"..."}`) is
 *     parsed and respected.
 *
 * @internal
 */

export type HookEvent = "preRun" | "postRun" | "preToolUse" | "postToolUse" | "stop";

export interface HookCommand {
  command: string;
  /** Optional matcher restricting the hook to specific tools (regex). */
  matcher?: string;
  /** Optional timeout in ms; defaults to 30s. */
  timeoutMs?: number;
}

export interface HookDecision {
  decision: "allow" | "deny" | "feedback";
  reason?: string;
  feedback?: string;
}

export interface HookPayload {
  event: HookEvent;
  tool?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  agentId?: string;
  runId?: string;
}

export interface HookExecutionResult {
  decisions: HookDecision[];
  blocked: boolean;
  reason?: string;
}

interface HookConfig {
  hooks?: Partial<Record<HookEvent, HookCommand[]>>;
}

export class HooksExecutor {
  private config: HookConfig = {};

  constructor(private readonly cwd: string) {}

  async initialize(settingSourcesIncludeProject: boolean): Promise<void> {
    if (!settingSourcesIncludeProject) {
      this.config = {};
      return;
    }
    const hooksPath = join(this.cwd, ".theokit", "hooks.json");
    let raw: string;
    try {
      raw = await readFile(hooksPath, "utf8");
    } catch (cause) {
      const err = cause as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        this.config = {};
        return;
      }
      throw new ConfigurationError(`Failed to read hooks config: ${hooksPath}`, {
        code: "hooks_read_error",
        cause,
      });
    }
    try {
      this.config = JSON.parse(raw) as HookConfig;
    } catch (cause) {
      throw new ConfigurationError(`Invalid JSON in hooks config: ${hooksPath}`, {
        code: "hooks_json_invalid",
        cause,
      });
    }
  }

  /** Fire every hook registered for `event` and aggregate the decisions. */
  async run(payload: HookPayload): Promise<HookExecutionResult> {
    const commands = this.commandsFor(payload.event, payload.tool);
    if (commands.length === 0) return { decisions: [], blocked: false };
    const decisions: HookDecision[] = [];
    for (const command of commands) {
      const decision = await this.executeOne(command, payload);
      decisions.push(decision);
      if (decision.decision === "deny") {
        const result: HookExecutionResult = {
          decisions,
          blocked: true,
        };
        if (decision.reason !== undefined) result.reason = decision.reason;
        return result;
      }
    }
    return { decisions, blocked: false };
  }

  private commandsFor(event: HookEvent, tool: string | undefined): HookCommand[] {
    const list = this.config.hooks?.[event] ?? [];
    if (tool === undefined) return list;
    return list.filter((entry) => {
      if (entry.matcher === undefined) return true;
      try {
        return new RegExp(entry.matcher).test(tool);
      } catch {
        return entry.matcher === tool;
      }
    });
  }

  private async executeOne(command: HookCommand, payload: HookPayload): Promise<HookDecision> {
    const timeoutMs = command.timeoutMs ?? 30_000;
    const result = await spawnAndCollect({
      command: "sh",
      args: ["-c", command.command],
      cwd: this.cwd,
      timeoutMs,
      stdin: JSON.stringify(payload),
    });
    if (result.timedOut) {
      return { decision: "deny", reason: `Hook timed out after ${timeoutMs}ms` };
    }
    if (result.spawnError !== undefined) {
      return { decision: "deny", reason: `Hook spawn failed: ${result.spawnError.message}` };
    }
    if (result.exitCode !== 0) {
      return {
        decision: "deny",
        reason:
          result.stderr.trim().length > 0
            ? result.stderr.trim()
            : `Hook exited with code ${result.exitCode}`,
      };
    }
    return parseDecisionFromStdout(result.stdout);
  }
}

function parseDecisionFromStdout(stdout: string): HookDecision {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return { decision: "allow" };
  try {
    const parsed = JSON.parse(trimmed) as Partial<HookDecision> & {
      decision?: string;
    };
    if (parsed.decision === "deny" || parsed.decision === "feedback") {
      const result: HookDecision = { decision: parsed.decision };
      if (parsed.reason !== undefined) result.reason = parsed.reason;
      if (parsed.feedback !== undefined) result.feedback = parsed.feedback;
      return result;
    }
    if (parsed.decision === "allow") return { decision: "allow" };
  } catch {
    // Treat unparseable stdout as feedback rather than failure.
    return { decision: "feedback", feedback: trimmed };
  }
  return { decision: "allow" };
}
