/**
 * `read_file` — built-in tool for coding agents.
 *
 * Reads a project-relative file as UTF-8 and returns its contents.
 * Hardened against the four bug families a coding agent normally hits:
 *
 *   1. **Path traversal** — `safePathJoin` rejects literal `..`,
 *      normalised escape, absolute segments, null-byte injection.
 *   2. **Symlink escape** — `assertNoSymlinkEscape` follows the full
 *      chain (and any intermediate symlinks; defence-in-depth fix v1.x).
 *   3. **Sensitive files** — `isForbiddenPath` blocks `.env*` (except
 *      `.env.example`), `.git/`, `node_modules/`, `.theo/`, lock files.
 *   4. **Binary files** — null-byte check on the first 8 KB. PNG/JPEG/
 *      compiled binaries return a structured `binary_file` error
 *      instead of garbled UTF-8 (EC-5 from the TheoKit Studio review).
 *
 * Return shape (always a JSON string the LLM consumes):
 *   - `{ ok: true, content: string }` on success
 *   - `{ ok: false, error: 'path_traversal' | 'forbidden_path' |
 *        'binary_file' | 'not_found' | 'too_large' }` on refusal
 *
 * The handler intentionally never throws on a "user mistake"
 * (traversal / forbidden / not found). Throwing reserved for SDK-side
 * mistakes that should crash the agent loop (input parse errors).
 */

import { type FileHandle, open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { CustomTool } from "@theokit/sdk";
import { Tool } from "@theokit/sdk";
import {
  FileNotFoundError,
  type FilesystemBackend,
  type FilesystemProvider,
  FilesystemSecurityError,
  resolveFilesystem,
} from "@theokit/sdk/filesystem";
import { z } from "zod";
import {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  isForbiddenPath,
  PathTraversalError,
  safePathJoin,
} from "./internal/path-guard.js";
import { isForbiddenAtAnyDepth } from "./path-scope.js";
import type { ReadTracker } from "./read-tracker.js";

/** Max single-file read size, in bytes. 5 MB ceiling — enough for any source file. */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Byte window inspected for null bytes when deciding binary vs text. */
const BINARY_PROBE_BYTES = 8 * 1024;

export interface CreateReadFileToolOptions {
  /** M76 — name exposed to the model. Omitted => today's literal (additive). The name is a contract:
   *  the approval key, what the model sees and what telemetry records. */
  name?: string;
  /** M76 — description exposed to the model. Omitted => today's literal (additive). */
  description?: string;
  /** Absolute path to the project root. Every read is gated against this boundary. */
  projectRoot: string;
  /**
   * SE32 — optional read-before-write tracker. When provided, a successful read
   * records the file's mtime so a paired `write_file` (with
   * `requireReadBeforeWrite`) can refuse a blind or stale overwrite.
   */
  readTracker?: ReadTracker;
  /**
   * SE31 — optional pluggable filesystem backend (`@theokit/sdk/filesystem`), or
   * a per-request resolver. When provided, reads route through the backend (its
   * own boundary + `basePath`) instead of the local `projectRoot`; omitted ⇒
   * identical current behavior (multi-tenant / per-request roots).
   */
  filesystem?: FilesystemProvider;
  /**
   * M17 — render a `cat -n`-style numbered view (`<n>\t<line>`) instead of raw content, so the model can
   * cite / edit by line number (Codex / Claude-Code read idiom). Default `false` ⇒ raw content (unchanged).
   */
  lineNumbers?: boolean;
  /**
   * M17 — opt-in "reads-anywhere" (Codex read-only sandbox): honor an ABSOLUTE `path` outside `projectRoot`
   * instead of rejecting it as traversal. The `isForbiddenPath` secret guard STILL fires first, so `.env`/
   * `.git`/lock files remain blocked. Default `false` ⇒ absolute paths rejected (unchanged). Opt-in only —
   * this widens the read boundary to the whole filesystem; enable only for a trusted local agent.
   */
  allowAbsolute?: boolean;
}

/** Secret guard for both read paths — the project-relative first-segment check plus, for an honored
 *  absolute path (`allowAbsolute`), an any-depth check. Returns an error JSON string, or null if safe. */
function forbiddenReadError(path: string, allowAbsolute: boolean): string | null {
  if (isForbiddenPath(path)) {
    return JSON.stringify({ ok: false, error: "forbidden_path", path });
  }
  if (allowAbsolute && isAbsolute(path) && isForbiddenAtAnyDepth(path)) {
    return JSON.stringify({ ok: false, error: "forbidden_path", path });
  }
  return null;
}

/** Render `content` as a raw string, or a paginated `<n>\t<line>` numbered view. Pure. */
function renderView(
  content: string,
  opts: { lineNumbers?: boolean; offset?: number; limit?: number },
): string {
  const paginated = opts.offset !== undefined || opts.limit !== undefined;
  if (!opts.lineNumbers && !paginated) return content; // default — byte-identical
  const lines = content.split("\n");
  const start = Math.max(1, opts.offset ?? 1);
  const end =
    opts.limit !== undefined ? Math.min(lines.length, start - 1 + opts.limit) : lines.length;
  const slice = lines.slice(start - 1, end);
  return opts.lineNumbers ? slice.map((l, i) => `${start + i}\t${l}`).join("\n") : slice.join("\n");
}

/**
 * Build the `read_file` tool.
 *
 * Success is `{ ok: true, content, size }`. Every refusal is a `{ ok: false, error }` value rather
 * than a throw, so the model can correct itself: `not_found`, `forbidden_path` (the sensitive-file
 * blocklist), `path_traversal` (escapes `projectRoot`, or the backend refused it), `binary_file` (a
 * null byte in the first 8 KB) and `too_large` (over 5 MB — a fixed ceiling, not an option).
 *
 * `offset`/`limit` page by line and `lineNumbers` renders a `cat -n` view (`<n>\t<line>`). Both are
 * applied after the whole file has been read, so they bound what the model sees, not what is read
 * from disk; the 5 MB cap is what bounds the read.
 *
 * `allowAbsolute` widens the boundary to the entire filesystem for absolute paths, leaving only the
 * any-depth secret guard in front of it. It is for a trusted local agent; on a shared or
 * multi-tenant host pass `filesystem` instead and let the backend own the boundary.
 *
 * Pass one {@link ReadTracker} here and the same instance to {@link createWriteFileTool} to enable
 * read-before-write: this tool records the mtime it saw, and the write tool then refuses to
 * overwrite a file that was never read or has changed since.
 */
export function createReadFileTool(opts: CreateReadFileToolOptions): CustomTool {
  const { projectRoot, readTracker, filesystem, lineNumbers, allowAbsolute } = opts;
  const numbered = lineNumbers === true ? " Returns a cat -n numbered view (`<n>\\t<line>`)." : "";
  const abs = allowAbsolute === true ? " Absolute paths outside the project are honored." : "";

  return Tool.create({
    name: opts.name ?? "read_file",
    description:
      opts.description ??
      "Read a text file as UTF-8. ALWAYS read a file before you edit it (edit_file) or overwrite it " +
        "(write_file), so your old_string / new content matches the real bytes exactly." +
        numbered +
        abs +
        " By default returns the whole file; use the optional offset (1-based first line) + limit to page " +
        "through a large file, or search_text to locate a symbol. Refuses sensitive files (.env, .git/, " +
        "node_modules/, .theo/, lock files) and " +
        "binary files (null byte in the first 8 KB); caps at 5 MB. Returns { ok, content, size } or " +
        "{ ok: false, error }.",
    inputSchema: z.object({
      path: z.string().min(1).describe("File path (project-relative; absolute when allowed)."),
      offset: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("1-based first line to read (default 1)."),
      limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Max number of lines to read (default: all)."),
    }),
    handler: async ({ path, offset, limit }, ctx) => {
      const forbidden = forbiddenReadError(path, allowAbsolute === true);
      if (forbidden !== null) return forbidden;
      const view = { lineNumbers, offset, limit };
      // SE31 — route through the pluggable backend when one is configured (the
      // backend owns its own boundary); else the local `projectRoot` fs.
      if (filesystem) {
        const backend = await resolveFilesystem(filesystem, ctx ?? {});
        return readViaBackend(backend, path, view, (mtimeMs) => readTracker?.record(path, mtimeMs));
      }
      const boundary = resolveBoundary(path, projectRoot, allowAbsolute === true);
      if ("error" in boundary) return boundary.error;
      const opened = await openHandleSafe(boundary.absolutePath, path);
      if ("error" in opened) return opened.error;
      try {
        return await readContent(opened.handle, path, view, (mtimeMs) =>
          readTracker?.record(path, mtimeMs),
        );
      } finally {
        await opened.handle.close();
      }
    },
  });
}

/** Render options threaded from the handler into the read paths. */
interface ViewOpts {
  lineNumbers?: boolean;
  offset?: number;
  limit?: number;
}

/**
 * SE31 — read through a {@link FilesystemBackend}, mapping its typed errors to
 * the tool's `{ ok: false, error }` JSON (never throws on a user mistake). The
 * binary/too-large guards mirror the local path; a null byte in the decoded
 * content flags a binary file.
 */
async function readViaBackend(
  backend: FilesystemBackend,
  path: string,
  view: ViewOpts,
  onRead?: (mtimeMs: number) => void,
): Promise<string> {
  try {
    const stat = await backend.stat(path);
    if (stat.size > MAX_FILE_SIZE) {
      return JSON.stringify({
        ok: false,
        error: "too_large",
        path,
        size: stat.size,
        limit: MAX_FILE_SIZE,
      });
    }
    const raw = await backend.readFile(path);
    if (raw.includes("\u0000")) {
      return JSON.stringify({ ok: false, error: "binary_file", path, size: stat.size });
    }
    onRead?.(stat.mtimeMs);
    return JSON.stringify({ ok: true, content: renderView(raw, view), size: stat.size });
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      return JSON.stringify({ ok: false, error: "not_found", path });
    }
    if (err instanceof FilesystemSecurityError) {
      return JSON.stringify({ ok: false, error: "path_traversal", path });
    }
    throw err;
  }
}

function resolveBoundary(
  path: string,
  projectRoot: string,
  allowAbsolute: boolean,
): { absolutePath: string } | { error: string } {
  // M17 — reads-anywhere: honor an absolute path (isForbiddenPath already ran; no projectRoot boundary).
  if (allowAbsolute && isAbsolute(path)) {
    return { absolutePath: path };
  }
  try {
    const absolutePath = safePathJoin(projectRoot, path);
    assertNoSymlinkEscape(absolutePath, projectRoot);
    return { absolutePath };
  } catch (err) {
    if (err instanceof PathTraversalError || err instanceof ForbiddenPathError) {
      return { error: JSON.stringify({ ok: false, error: "path_traversal", path }) };
    }
    throw err;
  }
}

async function openHandleSafe(
  absolutePath: string,
  path: string,
): Promise<{ handle: FileHandle } | { error: string }> {
  try {
    const handle = await open(absolutePath, "r");
    return { handle };
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "ENOENT") {
      return { error: JSON.stringify({ ok: false, error: "not_found", path }) };
    }
    throw err;
  }
}

async function readContent(
  handle: FileHandle,
  path: string,
  view: ViewOpts,
  onRead?: (mtimeMs: number) => void,
): Promise<string> {
  const stat = await handle.stat();
  if (stat.size > MAX_FILE_SIZE) {
    return JSON.stringify({
      ok: false,
      error: "too_large",
      path,
      size: stat.size,
      limit: MAX_FILE_SIZE,
    });
  }
  if (await isBinaryProbe(handle, Number(stat.size))) {
    return JSON.stringify({ ok: false, error: "binary_file", path, size: stat.size });
  }
  const raw = await handle.readFile({ encoding: "utf-8" });
  // SE32 — record the mtime read-before-write compares against. This is the
  // mtime captured at `handle.stat()` above; a concurrent external write between
  // that stat and this readFile is an accepted TOCTOU (the recorded snapshot may
  // trail the delivered content by one write — same-user local context). The
  // write-side guard still catches the common "edited after I read it" case.
  onRead?.(stat.mtimeMs);
  return JSON.stringify({ ok: true, content: renderView(raw, view), size: stat.size });
}

async function isBinaryProbe(handle: FileHandle, size: number): Promise<boolean> {
  const probeLen = Math.min(BINARY_PROBE_BYTES, size);
  if (probeLen <= 0) return false;
  const probe = Buffer.alloc(probeLen);
  const { bytesRead } = await handle.read(probe, 0, probeLen, 0);
  for (let i = 0; i < bytesRead; i += 1) {
    if (probe[i] === 0) return true;
  }
  return false;
}
