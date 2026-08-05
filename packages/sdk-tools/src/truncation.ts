/**
 * `truncateOutput` — utility for truncating large tool output.
 *
 * When output exceeds `maxBytes`, writes the full content to a temp file and returns a truncated
 * version with a reference to the full output.
 *
 * ## M77 — why this grew instead of a new truncator being written
 *
 * The M77 discovery measured **six** output ceilings across `sdk-tools`, with five different values
 * and no coordination between them (`web-fetch.ts` 1 MB, `shell-exec.ts` 5 MB, `git-diff.ts` 5 MB,
 * `run-vitest.ts` 10 MB, `git-status.ts` configurable, and this helper's 30 000 B). It also found
 * that this helper — exported from the barrel — had **zero production consumers**: the SDK had
 * already paid for a shared truncator that nobody used while every tool rolled its own.
 *
 * Adding a seventh ceiling in the runtime would have been the defect, not the fix. So `toolResultBudget`
 * extends this one instead (parsimony-ladder rung 4), gaining the two things it lacked:
 *
 *  - **`head-tail` mode** — the previous cut was head-only, which for command output discards
 *    exactly the part that matters: the error, the summary, the final prompt.
 *  - **`originalBytes`** — a machine-readable marker. The only prior signal was an English sentence
 *    injected into the text (`"[Output truncated. Full output: …]"`), so a consumer wanting to know
 *    how much was lost had to parse prose.
 *
 * Consolidating the MECHANISM is deliberately not the same as unifying the VALUES: 1 MB for
 * `web-fetch` and 10 MB for `run-vitest` may differ for good reasons. That second step is out of
 * scope here (plan ADR D2).
 *
 * Return shape:
 *   - `{ content, truncated: false, originalBytes }`
 *   - `{ content, truncated: true, originalBytes, overflowPath }`
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** How the middle is dropped when output exceeds the budget. */
export type TruncationMode = "head" | "head-tail";

export interface TruncationOptions {
  /** Maximum output size in bytes before truncation. Default: 30_000. */
  maxBytes?: number;
  /** Directory for overflow files. Default: ".theocode/tool-output". */
  outputDir?: string;
  /**
   * `"head"` (default) keeps the first `maxBytes` — the historical behaviour, preserved because this
   * helper is public API. `"head-tail"` splits the budget between the start and the END, which is
   * where command output usually carries its conclusion.
   */
  mode?: TruncationMode;
}

export interface TruncationResult {
  /** The (possibly truncated) content. */
  content: string;
  /** Whether the output was truncated. */
  truncated: boolean;
  /**
   * Byte length of the ORIGINAL output, present on both paths. Always present by design: a field
   * that only appears on failure forces every consumer through an `undefined` check, which is the
   * door magic values come in through.
   */
  originalBytes: number;
  /** Path to the full output file, present only when truncated. */
  overflowPath?: string;
}

/**
 * Cut a UTF-8 buffer at a byte boundary WITHOUT splitting a code point.
 *
 * `Buffer.subarray(0, n).toString()` on a boundary inside a multi-byte character yields U+FFFD, and
 * the model reads garbage. `TextDecoder` with `stream: true` withholds the incomplete tail instead of
 * substituting it — stdlib doing the work (parsimony-ladder rung 2).
 */
function decodeWholeCodePoints(buf: Buffer): string {
  return new TextDecoder("utf-8").decode(buf, { stream: true });
}

export function truncateOutput(output: string, opts?: TruncationOptions): TruncationResult {
  const maxBytes = opts?.maxBytes ?? 30_000;
  const outputDir = opts?.outputDir ?? ".theocode/tool-output";
  const mode = opts?.mode ?? "head";

  // EC-3: strict > comparison — exactly at limit is NOT truncated
  const originalBytes = Buffer.byteLength(output, "utf-8");
  if (originalBytes <= maxBytes) {
    return { content: output, truncated: false, originalBytes };
  }

  // Write full output to overflow file
  mkdirSync(outputDir, { recursive: true });
  // M77 — the name used to be `overflow-${Date.now()}.txt`, which COLLIDES: two truncations inside
  // the same millisecond resolve to the same path, and the second silently overwrites the first. The
  // `overflowPath` handed back to the caller then points at somebody else's output — a wrong answer,
  // not an error. Surfaced as an intermittent failure while running two truncation suites together;
  // `rules/testing.md § 3` treats a flake as a bug, and the root cause was in production code, not
  // in the test. `randomUUID` is stdlib (parsimony-ladder rung 2).
  const filename = `overflow-${Date.now()}-${randomUUID().slice(0, 8)}.txt`;
  const overflowPath = join(outputDir, filename);
  writeFileSync(overflowPath, output, "utf-8");

  const buf = Buffer.from(output, "utf-8");
  const trailer = `\n\n[Output truncated. Full output: ${overflowPath}]`;

  if (mode === "head-tail") {
    // Split the budget in half. The tail decode starts mid-buffer, so its first bytes may be a
    // continuation of a split code point; `decodeWholeCodePoints` drops the incomplete lead rather
    // than emitting U+FFFD.
    const half = Math.floor(maxBytes / 2);
    const head = decodeWholeCodePoints(buf.subarray(0, half));
    const tail = decodeWholeCodePoints(buf.subarray(buf.length - half));
    return {
      content: `${head}\n\n[… ${String(originalBytes - maxBytes)} bytes omitted …]\n\n${tail}${trailer}`,
      truncated: true,
      originalBytes,
      overflowPath,
    };
  }

  return {
    content: decodeWholeCodePoints(buf.subarray(0, maxBytes)) + trailer,
    truncated: true,
    originalBytes,
    overflowPath,
  };
}
