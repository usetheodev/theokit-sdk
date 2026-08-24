/**
 * M81 — transcript operations the consumer was doing by hand INSIDE the framework's own store.
 *
 * ## What this replaces
 *
 * `agents/lib/session/backtrack.ts:188` (agent-builder) wrote straight into the session store with a
 * bare `writeFileSync` — no atomicity, no lock, no API. 243 lines re-implementing parse, cut and
 * write for a format the framework owns. The consumer is not at fault: nothing here was reachable.
 *
 * ## The rule that travels WITH the operation
 *
 * `rules/audit-trail-rotation.md § Session transcripts (M60)` defines a NEVER-delete list — the live
 * pointer, the most recent transcript, and any active registry entry. That rule lived in the
 * CONSUMER. Moving the operation here without moving the rule would ship an API able to destroy
 * exactly what the rule protects — the same shape of defect as M80's `reconcileUpdateGoalStatus`:
 * critical knowledge outside the module that needs it, applied by convention.
 *
 * So `forkTranscript` takes `liveSessionPaths` and refuses, with a TYPED error, to write over any of
 * them. The caller supplies the list because only the caller knows which session is live; the
 * enforcement lives here because that is where the write happens.
 *
 * @internal
 */

import { closeSync, fstatSync, openSync, readFileSync, readSync, writeSync } from "node:fs";

import { TheokitAgentError } from "../../errors.js";

/**
 * M81 — the target is a protected session (live pointer / most-recent transcript / active entry).
 *
 * Typed rather than a bare `Error` because the caller must distinguish "this session is protected"
 * from "the disk is full": the first is a correct refusal, the second is an incident.
 */
export class LiveSessionError extends TheokitAgentError {
  override readonly name = "LiveSessionError";

  constructor(readonly path: string) {
    super(
      `refusing to write over a live session transcript: ${path}. ` +
        "Fork to a new id instead — the live pointer, the most recent transcript and any active " +
        "registry entry are never overwritten (audit-trail rotation, M60).",
      { code: "live_session_protected", isRetryable: false },
    );
  }
}

/** Options for {@link forkTranscript}. */
export interface ForkTranscriptOptions {
  /** Keep records `[0, beforeRecordIndex)`. Omit to copy the whole transcript. */
  readonly beforeRecordIndex?: number;
  /**
   * Paths that must never be written over — the live pointer, the most recent transcript, any active
   * registry entry. The caller supplies them because only the caller knows which session is live.
   */
  readonly liveSessionPaths?: readonly string[];
  /**
   * M107 — permission bits for the created destination. Default: `0o600`.
   *
   * A transcript carries the conversation. Before M107 no mode was passed at all, so the file was
   * born `0o666 & ~umask` — measured `0o664` (group-WRITABLE) on a `umask 002` machine, `0o644` on
   * `umask 022`, `0o466` on `umask 0200`. This is a DEFAULT and not a required knob on purpose: a
   * knob would reach zero consumers by omission, which is the failure mode that matters.
   *
   * As with any `open` mode, the `umask` may still CLEAR bits — under `umask 0200` the result is
   * `0o400`. That is accepted: the invariant bought here is "neither group nor others", and `0o400`
   * satisfies it more strictly. The SDK deliberately does not `fchmod` the default back, because
   * that would hand back a bit the operator asked to remove.
   */
  readonly mode?: number;
}

/**
 * Copy `src` into `dst`, keeping the first `beforeRecordIndex` records. The SOURCE is never touched.
 *
 * Atomicity comes from `wx` (exclusive create): two concurrent forks to the same destination cannot
 * both succeed — the loser gets `EEXIST` rather than writing over a half-written file. That is also
 * why an existing destination is a refusal, not a silent overwrite: losing a transcript without an
 * error is the worst failure mode for an operation that touches user sessions.
 */
export function forkTranscript(
  src: string,
  dst: string,
  options: ForkTranscriptOptions = {},
): void {
  for (const live of options.liveSessionPaths ?? []) {
    if (live === dst) throw new LiveSessionError(dst);
  }

  const lines = readFileSync(src, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const kept =
    options.beforeRecordIndex === undefined ? lines : lines.slice(0, options.beforeRecordIndex);
  const body = kept.length > 0 ? `${kept.join("\n")}\n` : "";

  // `wx` — fails with EEXIST instead of truncating. The exclusivity IS the concurrency guarantee,
  // and M107 only added the third argument: the mode. See `ForkTranscriptOptions.mode`.
  const fd = openSync(dst, "wx", options.mode ?? 0o600);
  try {
    writeSync(fd, body);
  } finally {
    closeSync(fd);
  }
}

/** Options for {@link readJsonlTail}. */
export interface ReadJsonlTailOptions {
  /** Maximum records to return, counted from the END. */
  readonly maxRecords?: number;
  /**
   * Start the window AFTER the last record whose `subtype` (or `type`) equals this.
   *
   * Matched STRUCTURALLY since T2.5. It used to be `line.includes(marker)`, so any message
   * mentioning the marker in its text truncated the read — silently, with a successful return.
   */
  readonly sinceMarker?: string;
  /** Test-only: also report how many bytes were read, to prove the read is not whole-file. */
  readonly _stats?: boolean;
}

const TAIL_CHUNK = 64 * 1024;

/**
 * Reads chunks backwards until enough complete lines have accumulated.
 *
 * Extracted from `readJsonlTail` because the read loop and the record selection are two
 * responsibilities — and together they exceeded the complexity ceiling. The buffer's first line may
 * be cut in half when the read stopped before the start of the file; that is why it is discarded.
 */
function readRawTail(path: string, want: number): { lines: string[]; bytesRead: number } {
  // Opened FIRST, then sized through the descriptor. `statSync(path)` followed by
  // `openSync(path)` resolves the name twice, and `size` is what drives every read offset below —
  // so a path that changed between the two calls would have the loop seeking by one file's length
  // inside another (CodeQL js/file-system-race #19). `fstat` on the open fd describes the file
  // being read, by construction.
  const fd = openSync(path, "r");
  const size = fstatSync(fd).size;
  let bytesRead = 0;
  let tail = "";
  let pos = size;
  try {
    while (pos > 0) {
      const len = Math.min(TAIL_CHUNK, pos);
      pos -= len;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, pos);
      bytesRead += len;
      tail = buf.toString("utf8") + tail;
      if (nonEmptyLines(tail).length > want) break;
    }
  } finally {
    closeSync(fd);
  }
  const lines = nonEmptyLines(tail);
  return { lines: pos > 0 ? lines.slice(1) : lines, bytesRead };
}

/** Non-empty lines, in file order. */
function nonEmptyLines(text: string): string[] {
  return text.split("\n").filter((l) => l.trim().length > 0);
}

/**
 * Whether a raw JSONL line IS the marker record, rather than a line that talks about it.
 *
 * Matches on the record's own discriminants (`subtype`, then `type`) — the fields that identify
 * what a record *is*. Free text is never consulted, which is the whole point: content is the user's
 * and must not steer the reader.
 *
 * A line that does not parse is not a marker. Deciding a window boundary from bytes that are not a
 * record would be guessing, and this function exists because guessing is what it replaced.
 */
function isMarkerRecord(line: string, marker: string): boolean {
  let record: { type?: unknown; subtype?: unknown };
  try {
    record = JSON.parse(line) as { type?: unknown; subtype?: unknown };
  } catch {
    return false;
  }
  return record.subtype === marker || record.type === marker;
}

/**
 * Read the LAST records of a JSONL file without loading the whole thing.
 *
 * Reads fixed-size chunks backwards from EOF until enough newlines have been seen. A session
 * transcript grows without bound; loading megabytes to show the last three turns is the cost this
 * exists to avoid — and a `slice` over a full read would be that same cost with a better name.
 */
export function readJsonlTail<T = Record<string, unknown>>(
  path: string,
  options: ReadJsonlTailOptions = {},
): T[] {
  const want = options.maxRecords ?? Number.POSITIVE_INFINITY;
  const { lines, bytesRead } = readRawTail(path, want);

  let sel = lines;
  if (options.sinceMarker !== undefined) {
    const marker = options.sinceMarker;
    // STRUCTURAL, not `line.includes(marker)`.
    //
    // A raw substring match is true for any line that merely MENTIONS the marker — a user asking
    // "how does compact_boundary work?" silently truncated the window to start at their question.
    // The read then succeeded, returned fewer records than exist, and said nothing. That is the
    // measured reason the only would-be consumer kept its own reader instead of this one.
    const idx = sel.findLastIndex((l) => isMarkerRecord(l, marker));
    if (idx >= 0) sel = sel.slice(idx + 1);
  }
  if (Number.isFinite(want)) sel = sel.slice(-want);

  const out = sel.map((l) => JSON.parse(l) as T);
  return options._stats === true ? (Object.assign(out, { bytesRead }) as T[]) : out;
}
