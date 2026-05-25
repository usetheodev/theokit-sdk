/**
 * Scaffold engine for `theokit init` (T2.1, ADRs D196 + D200).
 *
 * Walks `templates/<name>/`, copies files to `<dest>/`, performs
 * placeholder substitution (`{{projectName}}`, `{{sdkVersion}}`).
 *
 * **EC-B MUST FIX**: writes go to `<dest>.tmp-<random>/` first, then
 * atomic `renameSync` at the end. On any error mid-copy, the tmp dir
 * is cleaned up — `<dest>` is either fully scaffolded or absent.
 *
 * **EC-G MUST TEST**: symlinks at `<dest>` are rejected (path-guard).
 *
 * @internal
 */

import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SDK_VERSION } from "../version.js";
import { findTemplate } from "./templates.js";
import { validateProjectName } from "./validate-name.js";

export interface ScaffoldOptions {
  projectName: string;
  template: string;
  cwd: string;
  force?: boolean;
}

export interface ScaffoldResult {
  destAbs: string;
  filesWritten: number;
}

/** Files NOT substituted (binary/strict-content). All current templates are text-only. */
const SUBSTITUTE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
  ".md",
  ".env",
  ".example",
  ".gitignore",
  ".yml",
  ".yaml",
]);

/**
 * Resolve the bundled `templates/` directory. Works in both:
 *   - dev (loaded from src/, templates at ../templates relative to src/init/)
 *   - published (loaded from dist/, templates at ../../templates relative to dist/init/)
 */
function resolveTemplatesRoot(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  // Walk up looking for a `templates/` sibling.
  let dir = here;
  for (let i = 0; i < 5; i += 1) {
    const candidate = join(dir, "templates");
    if (existsSync(candidate) && lstatSync(candidate).isDirectory()) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate bundled templates/ directory (searched up from ${here}). ` +
      `This usually means the published tarball was built without "files": ["templates"] (EC-C regression).`,
  );
}

export async function scaffold(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  // EC-A: validate project name BEFORE any fs touch.
  const nameCheck = validateProjectName(opts.projectName);
  if (!nameCheck.ok) {
    const reason = nameCheck.reason ?? "Invalid project name.";
    const err = new Error(reason) as Error & { code?: string };
    err.code = "invalid_project_name";
    throw err;
  }

  const template = findTemplate(opts.template);
  if (template === undefined) {
    const err = new Error(`Unknown template "${opts.template}".`) as Error & { code?: string };
    err.code = "unknown_template";
    throw err;
  }

  const cwdAbs = resolve(opts.cwd);
  const destAbs = resolve(cwdAbs, opts.projectName);

  // Path-guard: dest must be inside cwd (no `../escape`).
  const rel = relative(cwdAbs, destAbs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    const err = new Error(
      `Project name "${opts.projectName}" escapes the working directory.`,
    ) as Error & { code?: string };
    err.code = "invalid_dest";
    throw err;
  }

  // EC-G: reject if dest is a symlink (don't follow into another dir).
  if (existsSync(destAbs)) {
    if (lstatSync(destAbs).isSymbolicLink()) {
      const err = new Error(
        `Destination "${destAbs}" is a symlink. Refuse to follow (EC-G safety).`,
      ) as Error & { code?: string };
      err.code = "dest_is_symlink";
      throw err;
    }
    // Existing non-empty dir requires --force.
    const isNonEmpty = readdirSync(destAbs).length > 0;
    if (isNonEmpty && opts.force !== true) {
      const err = new Error(
        `Destination "${destAbs}" already exists and is not empty. Pass --force to overwrite.`,
      ) as Error & { code?: string };
      err.code = "dest_not_empty";
      throw err;
    }
  }

  // EC-B: atomic tmp-then-rename.
  const tmpAbs = `${destAbs}.tmp-${randomBytes(4).toString("hex")}`;
  const templatesRoot = resolveTemplatesRoot();
  const sourceAbs = join(templatesRoot, opts.template);

  if (!existsSync(sourceAbs)) {
    throw new Error(
      `Template directory not found: ${sourceAbs}. Ensure the published package included templates/ (EC-C).`,
    );
  }

  let filesWritten = 0;
  try {
    mkdirSync(tmpAbs, { recursive: true });
    filesWritten = copyTreeWithSubstitution(sourceAbs, tmpAbs, {
      projectName: opts.projectName,
      sdkVersion: SDK_VERSION,
    });
    // If user passed --force and dest exists, wipe it before rename.
    if (existsSync(destAbs)) {
      rmSync(destAbs, { recursive: true, force: true });
    }
    renameSync(tmpAbs, destAbs);
  } catch (err) {
    // Cleanup tmp on any mid-copy failure.
    try {
      rmSync(tmpAbs, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    throw err;
  }

  return { destAbs, filesWritten };
}

interface SubstitutionVars {
  projectName: string;
  sdkVersion: string;
}

function copyTreeWithSubstitution(srcDir: string, destDir: string, vars: SubstitutionVars): number {
  // For test-friendliness + substitution control, walk the tree ourselves
  // instead of using `cpSync` opaque copy.
  let count = 0;
  function walk(src: string, dst: string): void {
    const entries = readdirSync(src, { withFileTypes: true });
    mkdirSync(dst, { recursive: true });
    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const dstPath = join(dst, entry.name);
      if (entry.isDirectory()) {
        walk(srcPath, dstPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const content = readFileSync(srcPath, "utf8");
      const ext = entry.name.includes(".") ? `.${entry.name.split(".").pop() ?? ""}` : "";
      const shouldSubstitute =
        SUBSTITUTE_EXTS.has(ext) || entry.name === ".gitignore" || entry.name === ".env.example";
      const out = shouldSubstitute
        ? content
            .replaceAll("{{projectName}}", vars.projectName)
            .replaceAll("{{sdkVersion}}", vars.sdkVersion)
        : content;
      writeFileSync(dstPath, out, "utf8");
      count += 1;
    }
  }
  walk(srcDir, destDir);
  // `cpSync` left in import list for future use (e.g., copying binary
  // assets). Currently unused.
  void cpSync;
  return count;
}
