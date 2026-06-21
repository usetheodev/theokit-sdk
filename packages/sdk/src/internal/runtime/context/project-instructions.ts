import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigurationError } from "../../../errors.js";
import { replaceFileAtomic } from "../../persistence/atomic-write.js";
import { isSafePattern, walkUpForFile } from "./context-discovery.js";

/** How discovered instruction files are reduced to a single `content` string. */
export type ProjectInstructionScope = "nearest" | "merged";

/** One discovered project-instruction file. */
export interface ProjectInstructionFile {
  /** Absolute path to the file. */
  path: string;
  /** Full file content (never truncated — the caller bounds it). */
  content: string;
}

/** Result of {@link readProjectInstructions}. */
export interface ProjectInstructions {
  /** Found files, nearest-first (innermost directory first). Empty if none. */
  files: ProjectInstructionFile[];
  /**
   * The `scope`-selected reduction: `nearest` → the innermost file's content;
   * `merged` → all files joined root-first (nearest content last). `undefined`
   * when no file was found.
   */
  content: string | undefined;
}

/** Options for {@link readProjectInstructions}. */
export interface ReadProjectInstructionsOptions {
  /** Instruction filename to discover. Default `"THEO.md"`. */
  filename?: string;
  /** How to reduce the found files to `content`. Default `"nearest"`. */
  scope?: ProjectInstructionScope;
  /** Stop the upward walk at this directory (inclusive). Default: filesystem root. */
  stopDir?: string;
}

/** Options for {@link writeProjectInstructions}. */
export interface WriteProjectInstructionsOptions {
  /** Instruction filename to write. Default `"THEO.md"`. */
  filename?: string;
}

const DEFAULT_FILENAME = "THEO.md";

/**
 * Read hierarchical project instructions by walking up from `cwd`.
 *
 * Discovers every `<dir>/<filename>` from `cwd` up to the filesystem root (or
 * `stopDir`), reads each, and returns them nearest-first in `files` plus a
 * `content` reduction chosen by `scope`. Composes the hardened internal
 * `walkUpForFile` (64-level cap, realpath dedup, FS-race tolerant).
 *
 * NEVER throws: a missing/unreadable directory or a path that exists but is not
 * a readable file is skipped; no instruction file → `{ files: [], content: undefined }`.
 *
 * Public via `@theokit/sdk/project`.
 *
 * @public
 */
export async function readProjectInstructions(
  cwd: string,
  options?: ReadProjectInstructionsOptions,
): Promise<ProjectInstructions> {
  const filename = options?.filename ?? DEFAULT_FILENAME;
  const scope = options?.scope ?? "nearest";
  const paths = walkUpForFile(cwd, filename, options?.stopDir);

  const files: ProjectInstructionFile[] = [];
  for (const path of paths) {
    try {
      files.push({ path, content: await readFile(path, "utf8") });
    } catch {
      // FS-race / unreadable / directory-named-like-file → skip (never-throw)
    }
  }

  return { files, content: reduceContent(files, scope) };
}

function reduceContent(
  files: ProjectInstructionFile[],
  scope: ProjectInstructionScope,
): string | undefined {
  if (files.length === 0) return undefined;
  if (scope === "merged") {
    return [...files]
      .reverse()
      .map((f) => f.content)
      .join("\n\n");
  }
  return files[0]?.content;
}

/**
 * Write project instructions to `<cwd>/<filename>` atomically (temp + fsync +
 * rename, via the shipped `replaceFileAtomic`).
 *
 * Unlike the reader, this FAILS LOUD: an unsafe `filename` (path traversal,
 * separators, absolute) is rejected with `ConfigurationError`
 * (`code: "unsafe_filename"`) — symmetric with the reader, whose `filename`
 * flows through the same `isSafePattern` guard — and a write error (e.g. the
 * parent directory does not exist) propagates to the caller. A failed mutation
 * is a real error, never silently swallowed.
 *
 * Public via `@theokit/sdk/project`.
 *
 * @public
 */
export async function writeProjectInstructions(
  cwd: string,
  content: string,
  options?: WriteProjectInstructionsOptions,
): Promise<void> {
  const filename = options?.filename ?? DEFAULT_FILENAME;
  if (!isSafePattern(filename)) {
    throw new ConfigurationError(
      `writeProjectInstructions: unsafe filename ${JSON.stringify(filename)} (no path traversal, separators, or absolute paths)`,
      { code: "unsafe_filename" },
    );
  }
  await replaceFileAtomic(join(cwd, filename), content);
}
