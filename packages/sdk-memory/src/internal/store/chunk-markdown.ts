import { createHash } from "node:crypto";

/**
 * **Iter 53 rollup-plugin-dts workaround** (mirrors iter 48
 * MemorySearchHit pattern). The canonical sdk-core copy imports
 * `MemoryChunk` from `../types.js`. In sdk-memory the same type lives
 * in sibling `./memory-types.js` (moved iter 52) but rollup-dts
 * treeshakes it out of the dist .d.ts because no PUBLIC type
 * references it transitively yet — the public `chunkMarkdown(text):
 * MemoryChunk[]` signature would be the first transitive reachable
 * consumer, BUT rollup-dts processes files in an order that asks for
 * the import resolution BEFORE chunk-markdown.ts itself becomes the
 * reachable consumer. Result: "MemoryChunk is not exported by
 * src/internal/memory-types.ts" build error.
 *
 * Fix: declare a byte-identical mirror of MemoryChunk inline. When a
 * future move turns MemoryChunk into a publicly-reachable type
 * through a different path (e.g. `index-db.ts` or `IndexManager`
 * methods that return arrays of it), this mirror MUST be deleted +
 * the canonical import restored to maintain single source of truth.
 *
 * @internal
 */
interface MemoryChunk {
  /** 1-indexed starting line in the source file. */
  startLine: number;
  /** 1-indexed ending line (inclusive). */
  endLine: number;
  /** Slice of markdown source text. */
  text: string;
  /** sha256 of `text`; stable across runs for identical inputs. */
  hash: string;
  /** Optional nearest heading text (without the `#` markers). */
  heading?: string;
}

/**
 * Split a markdown document into semantically meaningful chunks (ADR D1 of
 * memory-system-peer-project-parity).
 *
 * Algorithm:
 *   1. Walk lines tracking the current heading (latest `^#+ ` line).
 *   2. Split chunks at the next heading boundary AND on blank-line paragraph
 *      boundaries.
 *   3. If a single paragraph exceeds `maxChars`, split it at the nearest
 *      whitespace ≤ maxChars (word-aligned per edge-case review EC-6) —
 *      never mid-word.
 *
 * Mirrors peer-project's `chunkMarkdown` from
 * `packages/memory-host-sdk/src/host/chunk-markdown.ts`.
 *
 * Iter 53 (Stage 3 source-move #10): hybrid copy from sdk-core's
 * `internal/memory/storage/chunk-markdown.ts`. sdk-core retains its
 * copy for v1.x back-compat; sdk-memory ships the canonical copy that
 * future `storage/markdown-store`, `migration`, `index-db`, and
 * `index-manager` moves will target as siblings. The `MemoryChunk`
 * type comes from sibling `./memory-types.js` (moved iter 52).
 *
 * @internal
 */

export interface ChunkMarkdownOptions {
  /** Maximum chars per chunk. Default 800. */
  maxChars?: number;
  /** Minimum chars per chunk (avoids splintering tiny lines). Default 80. */
  minChars?: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

interface ChunkAccumulator {
  chunks: MemoryChunk[];
  lines: string[];
  start: number;
  heading: string | undefined;
}

/**
 * Split markdown into the chunks that get embedded and searched.
 *
 * Boundaries are structural rather than fixed-width: a chunk ends at the next
 * heading, or at a blank line. Each chunk carries the nearest preceding heading,
 * so a hit can be cited with the section it came from. A run of text longer than
 * `maxChars` is then cut at the last whitespace within 200 characters of the
 * limit, falling back to a hard cut when a single token is longer than that.
 *
 * Returns `[]` for empty input. `minChars` on the options is currently not read
 * — small paragraphs are emitted as their own chunks regardless.
 *
 * Line numbers are 1-indexed and inclusive at both ends. They are exact for
 * normal chunks; for a paragraph that had to be split by length, the numbers are
 * derived from newline counts within the slice and mark the span the slice came
 * from rather than a precise per-slice range.
 */
export function chunkMarkdown(text: string, options: ChunkMarkdownOptions = {}): MemoryChunk[] {
  const maxChars = options.maxChars ?? 800;
  if (text.length === 0) return [];
  const lines = text.split("\n");
  const acc: ChunkAccumulator = { chunks: [], lines: [], start: 1, heading: undefined };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNumber = i + 1;
    processLine(acc, line, lineNumber, maxChars);
  }
  flushAccumulator(acc, lines.length, maxChars);
  return acc.chunks;
}

function processLine(
  acc: ChunkAccumulator,
  line: string,
  lineNumber: number,
  maxChars: number,
): void {
  const headingMatch = HEADING_RE.exec(line);
  const isBlank = line.trim().length === 0;
  if (headingMatch !== null && acc.lines.length > 0) {
    flushAccumulator(acc, lineNumber - 1, maxChars);
  }
  if (headingMatch !== null) acc.heading = headingMatch[2];
  acc.lines.push(line);
  if (isBlank && acc.lines.length > 1) {
    const joined = acc.lines.join("\n");
    if (joined.trim().length > 0) flushAccumulator(acc, lineNumber, maxChars);
  }
}

function flushAccumulator(acc: ChunkAccumulator, endLineExclusive: number, maxChars: number): void {
  if (acc.lines.length === 0) return;
  const chunkText = acc.lines.join("\n");
  if (chunkText.trim().length === 0) {
    acc.lines = [];
    acc.start = endLineExclusive + 1;
    return;
  }
  if (chunkText.length > maxChars) {
    pushOversizedSlices(acc.chunks, chunkText, acc.start, acc.heading, maxChars);
  } else {
    acc.chunks.push(buildChunk(chunkText, acc.start, endLineExclusive, acc.heading));
  }
  acc.lines = [];
  acc.start = endLineExclusive + 1;
}

function buildChunk(
  text: string,
  startLine: number,
  endLine: number,
  heading: string | undefined,
): MemoryChunk {
  return {
    startLine,
    endLine,
    text,
    hash: createHash("sha256").update(text).digest("hex"),
    ...(heading !== undefined ? { heading } : {}),
  };
}

function pushOversizedSlices(
  chunks: MemoryChunk[],
  text: string,
  startLine: number,
  heading: string | undefined,
  maxChars: number,
): void {
  let remaining = text;
  let lineCursor = startLine;
  while (remaining.length > maxChars) {
    const splitAt = findWordBoundarySplit(remaining, maxChars);
    const slice = remaining.slice(0, splitAt);
    const sliceLines = slice.split("\n").length;
    chunks.push(buildChunk(slice, lineCursor, lineCursor + sliceLines - 1, heading));
    remaining = remaining.slice(splitAt).replace(/^\s+/, "");
    lineCursor += sliceLines - 1;
  }
  if (remaining.length > 0) {
    const sliceLines = remaining.split("\n").length;
    chunks.push(buildChunk(remaining, lineCursor, lineCursor + sliceLines - 1, heading));
  }
}

/**
 * Find a split point ≤ maxChars that lands on a whitespace boundary so we
 * don't slice a word in half. Falls back to maxChars if no whitespace is
 * within range (very rare — a single token > maxChars).
 */
function findWordBoundarySplit(text: string, maxChars: number): number {
  if (text.length <= maxChars) return text.length;
  // Walk backward from maxChars looking for whitespace.
  for (let i = maxChars; i > Math.max(0, maxChars - 200); i--) {
    if (/\s/.test(text[i] ?? "x")) return i;
  }
  // No whitespace within 200 chars of the cap — accept a hard split.
  return maxChars;
}
