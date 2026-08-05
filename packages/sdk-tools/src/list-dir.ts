/**
 * `list_dir` — built-in tool for coding agents.
 *
 * Returns the direct entries of a project-relative directory. Hardened
 * against the same four bug families as `read_file` plus the
 * **EC-6 unbounded output** failure mode: in a project with 10k files,
 * a naive listing returns a 5 MB JSON payload that freezes the browser
 * and (more importantly) blows past the LLM context window.
 *
 * Defaults:
 *   - `max = 500` entries (override via factory option `{ max }`)
 *   - Result includes `{ truncated: boolean, totalCount: number }` so the
 *     agent can decide whether to drill deeper or call `search_text` instead
 *
 * Result shape (always a JSON string):
 *   - `{ ok: true, entries: Array<{ name, type }>, truncated, totalCount }`
 *   - `{ ok: false, error: 'path_traversal' | 'forbidden_path' | 'not_found' }`
 */

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
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
import { ehProibidoEmQualquerProfundidade } from "./path-scope.js";

const DEFAULT_MAX_ENTRIES = 500;

export interface CreateListDirToolOptions {
  /**
   * M76 — nome exposto ao modelo. Omitido ⇒ o literal de hoje (aditivo).
   *
   * It exists because, in Codex, the name is BORN in the tool definition and is the approval decision key —
   * three consumers (model, approval, telemetry) of a string decided in one place. Renaming
   * after construction changes the identity of something already published to the model. `withName` remains
   * for the genuinely dynamic case.
   */
  name?: string;
  /** M76 — description exposed to the model. Omitted => today's literal (additive). */
  description?: string;
  /**
   * M76 — opt-in "lista-em-qualquer-lugar": honra um `path` ABSOLUTO fora de `projectRoot`
   * (paridade com `createReadFileTool`/`createSearchTextTool`, sandbox read-only do Codex).
   *
   * The ANY-segment secret guard still applies, and is not separable: `isForbiddenPath`
   * only blocks the sensitive item when it is the FIRST segment, so a `/home/u/proj/.env/sub`
   * would pass. Enabling the flag without the guard opens exfiltration. Default `false` => absolute rejected.
   */
  allowAbsolute?: boolean;
  /** Absolute path to the project root. Every listing is gated against this boundary. */
  projectRoot: string;
  /** Maximum number of entries returned per call. Default 500. */
  max?: number;
  /**
   * SE31 — optional pluggable filesystem backend (`@theokit/sdk/filesystem`), or
   * a per-request resolver. When provided, listings route through the backend
   * (its own boundary + `basePath`) instead of the local `projectRoot`; omitted
   * ⇒ identical current behavior (multi-tenant / per-request roots).
   */
  filesystem?: FilesystemProvider;
}

export function createListDirTool(opts: CreateListDirToolOptions): CustomTool {
  const { projectRoot, max = DEFAULT_MAX_ENTRIES, filesystem } = opts;

  return Tool.create({
    name: opts.name ?? "list_dir",
    description:
      opts.description ??
      `Return the direct entries of a project-relative directory. ` +
        `Refuses paths outside the project root or in the sensitive-file ` +
        `blocklist (.env, .git/, node_modules/, .theo/, lock files). Caps ` +
        `at ${String(max)} entries by default; result carries truncated + totalCount.`,
    inputSchema: z.object({
      path: z.string().min(1).describe("Project-relative directory path. Use '.' for root."),
    }),
    handler: async ({ path }, ctx) => {
      const relative = path === "" || path === "." ? "." : path;
      const verdict = decidirEscopo(relative, path, opts.allowAbsolute === true);
      if (verdict.error !== undefined) return verdict.error;
      if (verdict.absoluteRoot !== undefined) {
        return listViaLocalFs(verdict.absoluteRoot, ".", path, max);
      }
      // SE31 — route through the pluggable backend when one is configured; else
      // the local `projectRoot` fs.
      if (filesystem) {
        const backend = await resolveFilesystem(filesystem, ctx ?? {});
        return listViaBackend(backend, relative, path, max);
      }
      return listViaLocalFs(projectRoot, relative, path, max);
    },
  });
}

/**
 * `list_dir`'s scope decision, separated from the handler.
 *
 * Extracted because the SDK's complexity gate separated it for us — and it was right: DECIDING whether the
 * path may be read is the part with a security consequence, and deserves to be read alone. The handler
 * merely orchestrates afterwards.
 *
 * Returns `{ error }` when the path is refused, `{ absoluteRoot }` when it is an honored absolute, or
 * `{}` for the usual relative case.
 */
function decidirEscopo(
  relative: string,
  original: string,
  allowAbsolute: boolean,
): { error?: string; absoluteRoot?: string } {
  const refuse = (error: string): { error: string } => ({
    error: JSON.stringify({ ok: false, error, path: original }),
  });

  if (relative !== "." && isForbiddenPath(relative)) return refuse("forbidden_path");
  if (!isAbsolute(relative)) return {};

  // M76 — absolute only with opt-in, and ALWAYS with the per-segment guard: `isForbiddenPath` above only looks at
  // the FIRST segment, so a `/home/u/proj/.env/sub` would slip past it.
  if (!allowAbsolute) return refuse("path_traversal");
  if (ehProibidoEmQualquerProfundidade(relative)) return refuse("forbidden_path");
  return { absoluteRoot: relative };
}

/** Local-`projectRoot` listing: boundary + readdir + bounded format. */
async function listViaLocalFs(
  projectRoot: string,
  relative: string,
  originalPath: string,
  max: number,
): Promise<string> {
  const boundary = resolveDirBoundary(relative, projectRoot, originalPath);
  if ("error" in boundary) return boundary.error;
  const readResult = await readDirSafe(boundary.absolutePath, originalPath);
  if ("error" in readResult) return readResult.error;
  return formatListing(readResult.dirents, max);
}

/**
 * SE31 — list through a {@link FilesystemBackend}. The minimal backend `list()`
 * returns names only, so each entry's type is resolved via `stat()` (bounded by
 * `max`, so an entry with a transient stat failure defaults to `file`). Typed
 * backend errors map to the tool's `{ ok: false, error }` JSON.
 */
async function listViaBackend(
  backend: FilesystemBackend,
  relative: string,
  originalPath: string,
  max: number,
): Promise<string> {
  let names: string[];
  try {
    names = await backend.list(relative);
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      return JSON.stringify({ ok: false, error: "not_found", path: originalPath });
    }
    if (err instanceof FilesystemSecurityError) {
      return JSON.stringify({ ok: false, error: "path_traversal", path: originalPath });
    }
    throw err;
  }
  const totalCount = names.length;
  const windowed = names.slice(0, max);
  const entries = await Promise.all(
    windowed.map(async (name) => {
      const child = relative === "." ? name : `${relative}/${name}`;
      let type: "file" | "directory" = "file";
      try {
        type = (await backend.stat(child)).isDirectory ? "directory" : "file";
      } catch {
        // A transient stat failure (e.g. a symlink the backend rejects) defaults
        // to `file` — the listing still returns the entry name, never crashes.
      }
      return { name, type };
    }),
  );
  return JSON.stringify({ ok: true, entries, truncated: totalCount > max, totalCount });
}

function resolveDirBoundary(
  relative: string,
  projectRoot: string,
  originalPath: string,
): { absolutePath: string } | { error: string } {
  try {
    const absolutePath = relative === "." ? projectRoot : safePathJoin(projectRoot, relative);
    assertNoSymlinkEscape(absolutePath, projectRoot);
    return { absolutePath };
  } catch (err) {
    if (err instanceof PathTraversalError || err instanceof ForbiddenPathError) {
      return { error: JSON.stringify({ ok: false, error: "path_traversal", path: originalPath }) };
    }
    throw err;
  }
}

async function readDirSafe(
  absolutePath: string,
  originalPath: string,
): Promise<{ dirents: Dirent[] } | { error: string }> {
  try {
    const dirents = await readdir(absolutePath, { withFileTypes: true });
    return { dirents };
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "ENOENT" || e.code === "ENOTDIR") {
      return { error: JSON.stringify({ ok: false, error: "not_found", path: originalPath }) };
    }
    throw err;
  }
}

function formatListing(dirents: Dirent[], max: number): string {
  const totalCount = dirents.length;
  const truncated = totalCount > max;
  const entries = dirents.slice(0, max).map((d) => ({
    name: d.name,
    type: d.isDirectory() ? ("directory" as const) : ("file" as const),
  }));
  return JSON.stringify({ ok: true, entries, truncated, totalCount });
}
