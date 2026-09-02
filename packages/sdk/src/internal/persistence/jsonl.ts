/**
 * Durable JSONL primitives shared by the eval harness (M6).
 *
 * - `loadJsonl` — generic dataset reader (split/trim/skip-blank/parse) with a
 *   line-numbered {@link JsonlParseError}. The dataset SCHEMA is the caller's
 *   concern via `map` (M6 ADR D3) — this module owns only the parse.
 * - `appendJsonl` / `readJsonlIds` — crash-durable, resumable batch persistence
 *   (M6 ADR D1): each record is appended as one whole `\n`-terminated line the
 *   instant it is produced, and a re-run resumes by skipping already-keyed rows.
 *
 * reference: knowledge-base/references/theocode-eval/lib/swebench-dataset.ts:82
 * (parseJsonl + line-N error) and swebench-batch.ts:113,205 (resume + per-line
 * flush).
 *
 * @internal
 */
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { TheokitAgentError } from "../../errors.js";

/** Raised when a JSONL line is not valid JSON or is not a JSON object. Carries the 1-based line number. */
export class JsonlParseError extends TheokitAgentError {
  override readonly name = "JsonlParseError";
  constructor(
    message: string,
    readonly line: number,
  ) {
    // Not retryable: the bytes on the line do not change between reads.
    super(message, { code: "jsonl_parse_failed", isRetryable: false });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a single trimmed line to a plain object, or `undefined` if blank / invalid / non-object. */
function tryParseObjectLine(line: string): Record<string, unknown> | undefined {
  if (line.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  return isPlainObject(parsed) ? parsed : undefined;
}

/**
 * Parse a JSONL file into rows. Blank lines are skipped. A malformed or
 * non-object line throws {@link JsonlParseError} naming the 1-based line. When
 * `map` is provided, each raw object is mapped to the typed row (the SWE-bench
 * schema lives in the caller's `map`, per M6 ADR D3).
 */
export function loadJsonl<T = Record<string, unknown>>(
  path: string,
  opts: {
    map?: (raw: Record<string, unknown>, lineNumber: number) => T;
    /**
     * M81 — tolerate a truncated LAST line (a crash artifact: the process died mid-write).
     *
     * Opt-in on purpose. As a default it would also swallow corruption in the MIDDLE of the file,
     * turning loud data loss into silent data loss — the wrong trade for a session store.
     */
    tolerateTrailingPartialLine?: boolean;
  } = {},
): T[] {
  const lines = readFileSync(path, "utf8").split("\n");
  const out: T[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const line = (lines[i] ?? "").trim();
    if (line.length === 0) continue;
    // M81 — `undefined` = a tolerated invalid line (the last one, truncated by a crash). Any other
    // invalid line has already thrown inside `parseLine`.
    const parsed = parseLine(
      line,
      lineNumber,
      opts.tolerateTrailingPartialLine === true && lineNumber === lines.length,
    );
    if (parsed === undefined) break;
    out.push(opts.map ? opts.map(parsed, lineNumber) : (parsed as unknown as T));
  }
  return out;
}

/**
 * Parses ONE line, returning `undefined` when it is a tolerated truncated last line.
 *
 * Extracted because `loadJsonl` went over the cognitive-complexity ceiling once it gained the
 * tolerance — and because parsing a line and iterating a file are two responsibilities that were
 * only together out of habit.
 */
function parseLine(
  line: string,
  lineNumber: number,
  tolerate: boolean,
): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    if (tolerate) return undefined;
    throw new JsonlParseError(`line ${lineNumber}: invalid JSON`, lineNumber);
  }
  if (!isPlainObject(parsed)) {
    throw new JsonlParseError(`line ${lineNumber}: not a JSON object`, lineNumber);
  }
  return parsed;
}

/**
 * Append one record as a whole `\n`-terminated JSON line. Creates the parent dir
 * if missing. `appendFileSync` is synchronous, so within a single Node process
 * the event loop serializes writes and each call writes its line atomically —
 * interleave-safe for the bounded-concurrency batch runner.
 *
 * reference: swebench-batch.ts:192 (mkdir-before-append), :205 (per-line flush).
 */
export function appendJsonl(path: string, record: unknown): void {
  // T2.4 — `0o700` for the same reason the file below is `0o600`, and it is the half M93 missed. A
  // private file inside a group-writable directory can be replaced wholesale, and the replacement's
  // mode is whatever the writer chose. Under `umask 002` this directory was born `0775`.
  //
  // The directory sits under `~/.theokit`, shared with the credential and trust stores, and the
  // framework already wrote the diagnosis while fixing a sibling (`@theokit/agents
  // config/trust-store.ts:157-161`): the mode argument is a no-op on a directory that already
  // exists, "and this one is shared with the SDK's transcript root — whoever creates it first sets
  // the permissions". Whoever creates it first is usually THIS function, because a session writes a
  // transcript before it ever touches a credential. So `assertSecureModes` was not wrong to demand a
  // private directory; this path was wrong to produce one that fails it, depending on run order.
  //
  // Creation-time only, deliberately: repairing a pre-existing directory means `stat` + `chmod` on
  // every append, and this is the hot path of every session. The pre-existing case is what
  // `assertSecureModes` is for.
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const prefix = needsLineBreakBefore(path) ? "\n" : "";
  // M93 (adversarial review, H1) — `0o600`. `appendFileSync` takes no `mode`, so the permission came
  // from the umask: under `umask 022` the transcript was born `0664`, world-readable. The previous
  // path (`replaceFileAtomic`) pinned `0o600` on purpose — "holds the FULL in-flight content
  // (credential snapshots, OAuth tokens)" (`atomic-write.ts:107`) — and switching to append lost
  // that silently. The same class had already been caught in the consumer (`atomic-sync.ts`, M88
  // HIGH-1).
  //
  // `mode` only applies on CREATION; a pre-existing file keeps whatever permission it already has.
  const fd = openSync(path, "a", 0o600);
  try {
    writeSync(fd, `${prefix}${JSON.stringify(record)}\n`);
  } finally {
    closeSync(fd);
  }
}

/**
 * Does the file end without a `\n`? Then the last line is truncated — a crash mid-append.
 *
 * Without this check the next append **glues** itself onto the middle of the broken line, producing
 * an invalid line the reader discards: the NEW record disappears along with the partial one. The
 * previous path (read-modify-write) self-healed from this because it rewrote the whole file.
 * Measured in M93's adversarial review (H2): after an append over a truncated file, the
 * just-written record was no longer readable.
 *
 * Reads **one byte**, not the file.
 */
function needsLineBreakBefore(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return false; // the file does not exist yet: nothing to splice onto
  }
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return false;
    const buf = Buffer.alloc(1);
    readSync(fd, buf, 0, 1, size - 1);
    return buf[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}

/**
 * Read the set of keys from an existing JSONL file for which `keyFn(parsed)`
 * returns a non-empty string. Used to resume a crashed batch by skipping rows
 * already persisted with a successful result. A trailing partial line from an
 * interrupted append is tolerated (skipped, not thrown), and a missing file
 * yields an empty set.
 *
 * reference: swebench-batch.ts:113 (readDoneIds), :129 (success-only),
 * :131 (tolerate partial line).
 */
export function readJsonlIds(
  path: string,
  keyFn: (parsed: Record<string, unknown>) => string | undefined,
): Set<string> {
  const done = new Set<string>();
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return done; // no file yet → nothing done
  }
  for (const rawLine of text.split("\n")) {
    // A trailing partial line from an interrupted run parses to undefined → skipped.
    const parsed = tryParseObjectLine(rawLine.trim());
    if (parsed === undefined) continue;
    const key = keyFn(parsed);
    if (typeof key === "string" && key.length > 0) done.add(key);
  }
  return done;
}
