/**
 * Rich-error guidance for tool failures (M3-4).
 *
 * `withToolResultGuidance(tool, guidance)` wraps a `CustomTool` so a failing
 * `{ ok: false, error }` JSON result gains an LLM-actionable `guidance` string
 * telling the model how to self-correct. The injection is ADDITIVE (only on
 * `ok:false`), IDEMPOTENT (never overwrites an existing `guidance`), and
 * NEVER-THROW (a non-JSON / non-object / `ok:true` / unknown-code result is
 * returned unchanged). Composes over the existing built-in tools (and custom
 * tools) — no factory edits required.
 *
 * Design: blueprint m3-rich-errors. Zero new dependencies (JSON transform).
 */

import type { CustomTool } from "@theokit/sdk";

/** Maps a tool error code to a short, LLM-actionable self-correction hint. */
export type ToolGuidanceMap = Record<string, string>;

/** Curated hints for the common cross-tool error codes. Consumers may extend. */
export const DEFAULT_TOOL_GUIDANCE: ToolGuidanceMap = {
  not_found:
    "The path does not exist. Use `list_dir` or `glob_files` to find the correct path, then retry.",
  path_traversal: "That path escapes the project root. Use a path inside the project directory.",
  forbidden_path:
    "That path is a protected file (.env, .git, lock files, etc.). Choose a different, non-sensitive path.",
  no_match:
    "The search text was not found verbatim. Re-read the file with `read_file` and copy the exact text (including whitespace/indentation) before editing.",
  no_matches: "No files matched. Broaden the glob pattern or check the directory with `list_dir`.",
  timeout: "The operation timed out. Narrow the scope or pass a larger `timeout_ms`.",
  ssrf_blocked: "That host is private/loopback/reserved and is blocked. Use a public URL.",
  catastrophic_command:
    "That command is blocked as catastrophic. Use a safer, scoped command (e.g. a relative path instead of `/`).",
  binary_file: "The file is binary and cannot be read as text. Use a tool suited to binary data.",
  too_large:
    "The target is too large to process directly. Use a bounded range or a narrower scope.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pure: parse a tool handler's JSON output and ADD a `guidance` hint when the
 * result is an `{ ok: false, error }` object whose code has a hint and that does
 * not already carry guidance. Any other input is returned UNCHANGED (never throws).
 */
export function injectGuidance(handlerOutput: string, guidance: ToolGuidanceMap): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(handlerOutput);
  } catch {
    return handlerOutput; // non-JSON tool output → passthrough
  }
  if (!isRecord(parsed) || parsed.ok !== false) return handlerOutput;
  if (typeof parsed.guidance === "string") return handlerOutput; // idempotent
  const code = parsed.error;
  if (typeof code !== "string") return handlerOutput;
  const hint = guidance[code];
  if (!hint) return handlerOutput; // unknown code → no guidance
  return JSON.stringify({ ...parsed, guidance: hint });
}

/**
 * Wrap a `CustomTool` so its failed results gain a `guidance` hint from `guidance`.
 * Preserves name/description/inputSchema; only the handler output is augmented.
 */
export function withToolResultGuidance(tool: CustomTool, guidance: ToolGuidanceMap): CustomTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    handler: async (input) => injectGuidance(await tool.handler(input), guidance),
  };
}

/** `withToolResultGuidance` pre-bound to {@link DEFAULT_TOOL_GUIDANCE}. */
export function withDefaultGuidance(tool: CustomTool): CustomTool {
  return withToolResultGuidance(tool, DEFAULT_TOOL_GUIDANCE);
}
