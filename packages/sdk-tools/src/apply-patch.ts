/**
 * `apply_patch` — built-in tool for coding agents.
 *
 * Codex's V4A patch grammar (`*** Begin Patch` … `*** End Patch`): `*** Add/Update/Delete File:`, an
 * optional `*** Move to:`, and `@@`-anchored `+`/`-`/context hunks matched with a context-tolerant ladder
 * (exact → rstrip → trim → unicode). See `internal/v4a-patch.ts` for the parser + matcher.
 *
 * Applied STRICTLY atomically: the whole patch is planned (every file read + new content computed + path
 * security-checked) before ANY write. A parse error, context mismatch, or path violation anywhere ⇒ typed
 * error and ZERO writes (stronger than Codex, which writes file-by-file and can leave partial writes).
 *
 * Return shape (always a JSON string):
 *   - `{ ok: true, files_patched: string[] }`
 *   - `{ ok: false, error: 'parse_error' | 'path_traversal' | 'forbidden_path' | 'not_found' | 'patch_failed' }`
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CustomTool } from "@theokit/sdk";
import { Tool } from "@theokit/sdk";
import { z } from "zod";
import {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  isForbiddenPath,
  PathTraversalError,
  safePathJoin,
} from "./internal/path-guard.js";
import { applyUpdateChunks, parseV4A, type V4AHunk, V4APatchError } from "./internal/v4a-patch.js";

export interface CreateApplyPatchToolOptions {
  /** Absolute path to the project root. Every hunk path is gated against this boundary. */
  projectRoot: string;
}

export function createApplyPatchTool(opts: CreateApplyPatchToolOptions): CustomTool {
  const { projectRoot } = opts;

  return Tool.create({
    name: "apply_patch",
    description:
      "Apply a Codex-style V4A patch. The patch is `*** Begin Patch` … `*** End Patch` wrapping one or " +
      "more hunks: `*** Add File: <path>` (then `+`lines), `*** Delete File: <path>`, or `*** Update " +
      "File: <path>` (optional `*** Move to: <path>`) with `@@`-anchored `+` (add) / `-` (remove) / ` ` " +
      "(context) lines. Read a file first so your context/removed lines match. Applied atomically — a " +
      "mismatch anywhere aborts the whole patch with zero writes; each path is security-checked. Returns " +
      "{ ok, files_patched } or { ok: false, error }.",
    inputSchema: z.object({
      patch: z.string().min(1).describe("V4A patch: *** Begin Patch … *** End Patch."),
    }),
    handler: async ({ patch }) => applyV4APatch(projectRoot, patch),
  });
}

/** A single filesystem mutation in the apply plan. A `move` is expressed as a write + an rm. */
type FsOp = { write: { abs: string; content: string } } | { rm: string };

type PlanResult = { ops: FsOp[]; patched: string[] } | { error: string };

async function applyV4APatch(projectRoot: string, patch: string): Promise<string> {
  let hunks: V4AHunk[];
  try {
    hunks = parseV4A(patch);
  } catch (err) {
    const detail = err instanceof V4APatchError ? err.message : String(err);
    return JSON.stringify({ ok: false, error: "parse_error", detail });
  }
  // Plan (verify) the WHOLE patch before any write; then execute. First failure ⇒ zero writes.
  const plan = await buildPlan(projectRoot, hunks);
  if ("error" in plan) return plan.error;
  await executePlan(plan.ops);
  return JSON.stringify({ ok: true, files_patched: plan.patched });
}

/** Read + compute + path-check every hunk into a write plan (no writes). First failure aborts. */
async function buildPlan(projectRoot: string, hunks: V4AHunk[]): Promise<PlanResult> {
  const ops: FsOp[] = [];
  const patched: string[] = [];
  for (const hunk of hunks) {
    const planned = await planHunk(projectRoot, hunk);
    if ("error" in planned) return planned;
    ops.push(...planned.ops);
    patched.push(hunk.kind === "update" ? (hunk.movePath ?? hunk.path) : hunk.path);
  }
  return { ops, patched };
}

/** Execute the write plan (all reads/computes/checks already passed). */
async function executePlan(ops: FsOp[]): Promise<void> {
  for (const op of ops) {
    if ("rm" in op) {
      await rm(op.rm, { force: true });
    } else {
      await mkdir(dirname(op.write.abs), { recursive: true });
      await writeFile(op.write.abs, op.write.content, "utf-8");
    }
  }
}

/** Plan one hunk (Codex Hunk-kind dispatch) into filesystem ops, or an error JSON string. */
async function planHunk(
  projectRoot: string,
  hunk: V4AHunk,
): Promise<{ ops: FsOp[] } | { error: string }> {
  const scope = v4aScope(projectRoot, hunk.path);
  if ("error" in scope) return scope;
  if (hunk.kind === "add") return { ops: [{ write: { abs: scope.abs, content: hunk.content } }] };
  if (hunk.kind === "delete") return { ops: [{ rm: scope.abs }] };
  return planUpdate(projectRoot, hunk, scope.abs);
}

/** Plan an Update hunk: read the OLD file, compute the new content, then write-in-place or move. */
async function planUpdate(
  projectRoot: string,
  hunk: Extract<V4AHunk, { kind: "update" }>,
  abs: string,
): Promise<{ ops: FsOp[] } | { error: string }> {
  let content: string;
  try {
    content = await readFile(abs, "utf-8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      return { error: JSON.stringify({ ok: false, error: "not_found", path: hunk.path }) };
    }
    throw err;
  }
  let updated: string;
  try {
    updated = applyUpdateChunks(content, hunk.path, hunk.chunks);
  } catch (err) {
    if (err instanceof V4APatchError) {
      return {
        error: JSON.stringify({
          ok: false,
          error: "patch_failed",
          path: hunk.path,
          detail: err.message,
        }),
      };
    }
    throw err;
  }
  if (!hunk.movePath) return { ops: [{ write: { abs, content: updated } }] };
  const dest = v4aScope(projectRoot, hunk.movePath);
  if ("error" in dest) return dest;
  // transform-then-rename: write the new content to the destination, remove the original.
  return { ops: [{ write: { abs: dest.abs, content: updated } }, { rm: abs }] };
}

/** Security-check a hunk path against the project root; returns the resolved abs path or an error JSON string. */
function v4aScope(projectRoot: string, file: string): { abs: string } | { error: string } {
  if (isForbiddenPath(file)) {
    return { error: JSON.stringify({ ok: false, error: "forbidden_path", path: file }) };
  }
  try {
    const abs = safePathJoin(projectRoot, file);
    assertNoSymlinkEscape(abs, projectRoot);
    return { abs };
  } catch (err) {
    if (err instanceof PathTraversalError || err instanceof ForbiddenPathError) {
      return { error: JSON.stringify({ ok: false, error: "path_traversal", path: file }) };
    }
    throw err;
  }
}
