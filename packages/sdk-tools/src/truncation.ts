/**
 * `truncateOutput` — utility for truncating large tool output.
 *
 * When output exceeds `maxBytes`, writes the full content to a temp file
 * and returns a truncated version with a reference to the full output.
 *
 * Return shape:
 *   - `{ content: string, truncated: false }`
 *   - `{ content: string, truncated: true, overflowPath: string }`
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface TruncationOptions {
  /** Maximum output size in bytes before truncation. Default: 30_000. */
  maxBytes?: number;
  /** Directory for overflow files. Default: ".theocode/tool-output". */
  outputDir?: string;
}

export interface TruncationResult {
  /** The (possibly truncated) content. */
  content: string;
  /** Whether the output was truncated. */
  truncated: boolean;
  /** Path to the full output file, present only when truncated. */
  overflowPath?: string;
}

export function truncateOutput(output: string, opts?: TruncationOptions): TruncationResult {
  const maxBytes = opts?.maxBytes ?? 30_000;
  const outputDir = opts?.outputDir ?? ".theocode/tool-output";

  // EC-3: strict > comparison — exactly at limit is NOT truncated
  const byteLength = Buffer.byteLength(output, "utf-8");
  if (byteLength <= maxBytes) {
    return { content: output, truncated: false };
  }

  // Write full output to overflow file
  mkdirSync(outputDir, { recursive: true });
  const filename = `overflow-${Date.now()}.txt`;
  const overflowPath = join(outputDir, filename);
  writeFileSync(overflowPath, output, "utf-8");

  // Truncate to maxBytes (approximate — cut at byte boundary then trim to valid UTF-8)
  const truncated = Buffer.from(output, "utf-8").subarray(0, maxBytes).toString("utf-8");
  const trailer = `\n\n[Output truncated. Full output: ${overflowPath}]`;

  return {
    content: truncated + trailer,
    truncated: true,
    overflowPath,
  };
}
