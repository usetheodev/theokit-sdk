/**
 * `ide-bridge` — IDE detection and command generation.
 *
 * Detects VS Code / Cursor via environment variables.
 * Produces structured IDE commands for opening files and showing diffs.
 */

export interface IdeCommand {
  type: "open" | "diff";
  path: string;
  line?: number;
  diff?: string;
}

/**
 * Detect the running IDE from environment variables.
 * Returns `null` if no recognized IDE is detected.
 */
export function detectIde(): "vscode" | "cursor" | null {
  // Cursor sets its own env var
  if (process.env["CURSOR_TRACE_DIR"] || process.env["CURSOR_CHANNEL"]) return "cursor";
  // VS Code sets VSCODE_PID or TERM_PROGRAM=vscode
  if (process.env["VSCODE_PID"] || process.env["TERM_PROGRAM"] === "vscode") return "vscode";
  return null;
}

/**
 * Build a structured IDE command descriptor.
 */
export function ideCommand(
  action: "open" | "diff",
  opts: { path: string; line?: number; diff?: string },
): IdeCommand {
  return {
    type: action,
    path: opts.path,
    ...(opts.line !== undefined && { line: opts.line }),
    ...(opts.diff !== undefined && { diff: opts.diff }),
  };
}
