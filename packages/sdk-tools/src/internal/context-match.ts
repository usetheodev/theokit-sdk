/**
 * Context-tolerant single-occurrence text matching (`seek_sequence` parity, ported
 * from the AgentBuilder Codex clone, M10/M13). Where a naive `edit_file` matches
 * `old_string` byte-for-byte (or with a single whitespace-normalized fallback),
 * this matcher is safe AND forgiving:
 *
 *   Stage 1 — exact byte substring, with an **ambiguity guard**: if the target
 *     appears more than once it throws instead of silently editing the first hit
 *     (a too-short `old_string` editing the wrong location is the classic footgun).
 *   Stage 2 — line-based match down a **strictness ladder** (exact → rstrip → trim
 *     → unicode-normalize), stopping at the first rung that yields exactly ONE
 *     match; a rung matching 2+ positions throws (ambiguous), never picks one.
 *
 * Pure. Preserves the file's CRLF/LF style on the replaced region. Throws typed
 * {@link ContextMatchError} (`empty | ambiguous | not_found`) so the caller maps to
 * its own `{ ok: false, error }` shape.
 */

export type ContextMatchReason = "empty" | "ambiguous" | "not_found";

/**
 * Thrown by {@link replaceUnique} when the replacement cannot be made safely. `reason` names the
 * case: `empty` (no target given), `ambiguous` (the target matched in more than one place, so nothing
 * was replaced), `not_found` (no rung of the ladder matched).
 *
 * `ambiguous` is the one worth handling apart from the others. It says the caller's target text is
 * too short, not that the file lacks it, so the remedy is more surrounding context rather than a
 * different search.
 */
export class ContextMatchError extends Error {
  readonly reason: ContextMatchReason;
  constructor(reason: ContextMatchReason, message: string) {
    super(message);
    this.name = "ContextMatchError";
    this.reason = reason;
  }
}

/** Normalize common Unicode punctuation to ASCII (dashes/quotes/odd-spaces) — the loosest ladder rung,
 *  mirroring `git apply`'s fuzz so an ASCII-authored edit still matches typographic source. */
function normalizeUnicode(s: string): string {
  return s
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘-‛]/g, "'")
    .replace(/[“-‟]/g, '"')
    .replace(/[ -   　]/g, " ");
}

/** The strictness ladder: each rung normalizes a line before comparison. */
const LINE_MATCH_LADDER: ReadonlyArray<(s: string) => string> = [
  (s) => s, // exact
  (s) => s.replace(/\s+$/, ""), // rstrip (ignore trailing whitespace)
  (s) => s.trim(), // trim (ignore leading + trailing)
  (s) => normalizeUnicode(s).trim(), // unicode + trim (loosest)
];

/** Whether `pattern` matches `lines` starting at index `i`, comparing each line under `norm`. */
function matchesAt(
  lines: string[],
  pattern: string[],
  i: number,
  norm: (s: string) => string,
): boolean {
  for (let p = 0; p < pattern.length; p++) {
    const lineAt = lines[i + p];
    const patAt = pattern[p];
    if (lineAt === undefined || patAt === undefined || norm(lineAt) !== norm(patAt)) return false;
  }
  return true;
}

/** Every start index where `pattern` matches `lines` under `norm`. */
function findHits(lines: string[], pattern: string[], norm: (s: string) => string): number[] {
  const hits: number[] = [];
  for (let i = 0; i + pattern.length <= lines.length; i++) {
    if (matchesAt(lines, pattern, i, norm)) hits.push(i);
  }
  return hits;
}

/**
 * Find the UNIQUE start line index where `pattern` matches `lines`, trying the ladder top-down.
 * Returns the index at the FIRST rung yielding exactly one match; `null` if none; throws (ambiguous)
 * if a rung matches 2+ positions. Empty or too-long pattern → null.
 */
function seekUniqueLineMatch(lines: string[], pattern: string[], find: string): number | null {
  if (pattern.length === 0 || pattern.length > lines.length) return null;
  for (const norm of LINE_MATCH_LADDER) {
    const hits = findHits(lines, pattern, norm);
    if (hits.length === 1) return hits[0] ?? null;
    if (hits.length > 1) {
      throw new ContextMatchError(
        "ambiguous",
        `target text is ambiguous (multiple matches); include more context:\n${find}`,
      );
    }
  }
  return null;
}

/**
 * Return `content` with the single occurrence of `find` replaced by `replace`, using the two-stage
 * context-tolerant matcher. Throws {@link ContextMatchError} on empty/ambiguous/not-found.
 */
export function replaceUnique(content: string, find: string, replace: string): string {
  if (find === "") {
    throw new ContextMatchError(
      "empty",
      "empty find is not a valid target; provide the text to replace",
    );
  }
  // Stage 1 — exact byte substring (fast path + uniqueness). The ambiguity re-scan starts at
  // `first + 1` (NOT `first + find.length`) so a self-OVERLAPPING find is still caught as ambiguous.
  const first = content.indexOf(find);
  if (first !== -1) {
    if (content.indexOf(find, first + 1) !== -1) {
      throw new ContextMatchError(
        "ambiguous",
        `target text is ambiguous (multiple matches); include more context:\n${find}`,
      );
    }
    return content.slice(0, first) + replace + content.slice(first + find.length);
  }
  // Stage 2 — line-based tolerant match (seek_sequence ladder).
  const lines = content.split("\n");
  const at = seekUniqueLineMatch(lines, find.split("\n"), find);
  if (at === null) {
    throw new ContextMatchError("not_found", `target text not found:\n${find}`);
  }
  const patternLen = find.split("\n").length;
  // Preserve the file's line-ending style: a CRLF file split on '\n' keeps a trailing '\r' per line.
  // If the MATCHED region is CRLF, re-attach '\r' to the (LF-authored) replace lines so the edit never
  // leaves mixed CRLF/LF endings behind.
  const matchedCrlf =
    patternLen > 0 && lines.slice(at, at + patternLen).every((l) => l.endsWith("\r"));
  const replaceLines = matchedCrlf
    ? replace.split("\n").map((l) => (l.endsWith("\r") ? l : `${l}\r`))
    : replace.split("\n");
  return [...lines.slice(0, at), ...replaceLines, ...lines.slice(at + patternLen)].join("\n");
}
