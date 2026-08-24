import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

/**
 * **Iter 55 rollup-plugin-dts workaround** (mirrors iter 48/53 pattern).
 * The canonical sdk-core copy imports `MemoryReadResult` from
 * `../types.js`. In sdk-memory the same type lives in sibling
 * `./memory-types.js` (moved iter 52) but rollup-dts treeshakes it
 * out of the dist .d.ts because no PUBLIC type reaches it
 * transitively yet — `readMemoryFileBounded`'s return type would be
 * the consumer BUT rollup-dts processes the import resolution before
 * reader.ts itself becomes bundled into the public emit. Same class
 * of bug as iter 48 (MemorySearchHit) + iter 53 (MemoryChunk).
 *
 * Fix: declare a byte-identical mirror of MemoryReadResult inline.
 * When a future move (e.g. tools.ts wrapping readMemoryFileBounded
 * as a public LLM tool, or IndexManager surface emitting these)
 * gives MemoryReadResult a different publicly-reachable path, this
 * mirror MUST be deleted + the canonical import restored to maintain
 * single source of truth.
 *
 * @internal
 */
interface MemoryReadResult {
  path: string;
  /** Requested starting line (1-indexed, defaults to 1). */
  from: number;
  /** Number of lines actually returned (may be less than `lines` near EOF). */
  linesReturned: number;
  /** Total lines in the file (after the read). */
  totalLines: number;
  /** True when content remains after the returned slice, i.e. `remainingLines > 0`. */
  truncated: boolean;
  /** Lines past the returned slice that remain in the file. */
  remainingLines: number;
  /** Slice text (joined with `\n`). */
  text: string;
}

/**
 * Bounded read with truncation info (ADR D5 — `memory_get` foundation).
 *
 * Mirrors peer-project's `buildMemoryReadResult` semantics:
 * - `from` is 1-indexed.
 * - `lines` defaults to 200 (`DEFAULT_MEMORY_READ_LINES`).
 * - Returns up to EOF when the requested slice extends past file end.
 * - Sets `truncated: true` whenever content remains past the returned slice,
 *   whether or not the slice was shorter than requested. (At EOF, `false`.)
 *
 * Iter 55 (Stage 3 source-move #12): hybrid copy from sdk-core's
 * `internal/memory/storage/reader.ts`. sdk-core retains its copy for
 * v1.x `memory_get` back-compat; sdk-memory ships the canonical copy
 * that future `tools.ts` move (memory_get LLM tool wraps this) will
 * target as a sibling. `MemoryReadResult` comes from sibling
 * `./memory-types.js` (moved iter 52).
 *
 * @internal
 */

export const DEFAULT_MEMORY_READ_LINES = 200;

/**
 * Inputs for {@link readMemoryFileBounded}. `relPath` is resolved against `cwd`,
 * and this function performs no containment check of its own — a `relPath`
 * containing `..` escapes. The `memory_get` tool validates containment before
 * calling in.
 *
 * `from` is 1-indexed and clamped to at least 1; `lines` defaults to 200 and is
 * clamped to at least 1.
 */
export interface ReadFileOptions {
  cwd: string;
  relPath: string;
  from?: number;
  lines?: number;
}

/**
 * Read a bounded slice of a text file and report what was left behind.
 *
 * A single trailing newline is not counted as a line, so `totalLines` matches
 * what an editor shows. `from` past the end of the file is not an error: it
 * returns an empty slice with `linesReturned: 0`.
 *
 * `truncated` means content remains after the returned slice — it is exactly
 * `remainingLines > 0`. It does not mean fewer lines were returned than
 * requested: a full 200-line slice of a 1000-line file is `truncated: true`,
 * and a short slice that reached the end is `truncated: false`.
 *
 * Rejects with the underlying filesystem error when the file cannot be read.
 */
export async function readMemoryFileBounded(opts: ReadFileOptions): Promise<MemoryReadResult> {
  const absolutePath = resolvePath(opts.cwd, opts.relPath);
  const raw = await readFile(absolutePath, "utf8");
  const allLines = raw.split("\n");
  // Strip a trailing empty line caused by a final \n so totalLines reflects
  // the editor-visible line count, not the byte-level split.
  const trimmedLines =
    allLines.length > 0 && allLines[allLines.length - 1] === "" ? allLines.slice(0, -1) : allLines;
  const totalLines = trimmedLines.length;

  const requestedFrom = Math.max(1, opts.from ?? 1);
  const requestedLines = Math.max(1, opts.lines ?? DEFAULT_MEMORY_READ_LINES);
  const startIdx = requestedFrom - 1;
  const endIdx = Math.min(totalLines, startIdx + requestedLines);
  const slice = trimmedLines.slice(startIdx, endIdx);
  const linesReturned = slice.length;
  const remainingLines = Math.max(0, totalLines - endIdx);
  // truncated = "more content exists past the returned slice"
  const truncated = remainingLines > 0;

  return {
    path: opts.relPath,
    from: requestedFrom,
    linesReturned,
    totalLines,
    truncated,
    remainingLines,
    text: slice.join("\n"),
  };
}
