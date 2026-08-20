/**
 * Scaffold engine for `theokit init` (T2.1, ADRs D196 + D200).
 *
 * Walks `templates/<name>/`, copies files to `<dest>/`, performs
 * placeholder substitution (`{{projectName}}`, `{{sdkVersion}}`).
 *
 * **EC-B MUST FIX**: writes go to `<dest>.tmp-<random>/` first, then `renameSync` at the end. On any
 * error mid-copy the tmp dir is removed, so `<dest>` is never left half-written.
 *
 * "Atomic" describes the FRESH case. Under `force`, an existing `<dest>` is deleted before the
 * rename, so a failure in that narrow window leaves neither the old tree nor the new one — and the
 * old tree is gone unconditionally, with no backup.
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

/** Input for {@link scaffold}. `projectName` doubles as the destination directory name. */
interface ScaffoldOptions {
  /** npm-valid package name; also the directory created under `cwd`. */
  projectName: string;
  /** Must be a name in the bundled registry. */
  template: string;
  /** Root the destination is resolved against and confined to. */
  cwd: string;
  /** Permit a non-empty destination by DELETING it first. Does not permit a symlink. */
  force?: boolean;
}

/** `filesWritten` counts regular files only; directories and any skipped entry are not counted. */
interface ScaffoldResult {
  destAbs: string;
  filesWritten: number;
}

/**
 * Extensions whose contents DO get `{{projectName}}` / `{{sdkVersion}}` substitution — despite the
 * name below, this is the include list, not an exclude list. `.gitignore` and `.env.example` are
 * matched by full filename as well. Anything else is copied byte-for-byte.
 */
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

function scaffoldError(code: string, message: string): Error & { code?: string } {
  const err = new Error(message) as Error & { code?: string };
  err.code = code;
  return err;
}

function validateNameAndTemplate(opts: ScaffoldOptions): void {
  const nameCheck = validateProjectName(opts.projectName);
  if (!nameCheck.ok) {
    throw scaffoldError("invalid_project_name", nameCheck.reason ?? "Invalid project name.");
  }
  if (findTemplate(opts.template) === undefined) {
    throw scaffoldError("unknown_template", `Unknown template "${opts.template}".`);
  }
}

function validateDest(cwdAbs: string, destAbs: string, projectName: string, force: boolean): void {
  const rel = relative(cwdAbs, destAbs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw scaffoldError(
      "invalid_dest",
      `Project name "${projectName}" escapes the working directory.`,
    );
  }
  if (!existsSync(destAbs)) return;
  if (lstatSync(destAbs).isSymbolicLink()) {
    throw scaffoldError(
      "dest_is_symlink",
      `Destination "${destAbs}" is a symlink. Refuse to follow (EC-G safety).`,
    );
  }
  if (readdirSync(destAbs).length > 0 && !force) {
    throw scaffoldError(
      "dest_not_empty",
      `Destination "${destAbs}" already exists and is not empty. Pass --force to overwrite.`,
    );
  }
}

function atomicCopy(
  sourceAbs: string,
  tmpAbs: string,
  destAbs: string,
  projectName: string,
): number {
  try {
    mkdirSync(tmpAbs, { recursive: true });
    const filesWritten = copyTreeWithSubstitution(sourceAbs, tmpAbs, {
      projectName,
      sdkVersion: SDK_VERSION,
    });
    if (existsSync(destAbs)) rmSync(destAbs, { recursive: true, force: true });
    renameSync(tmpAbs, destAbs);
    return filesWritten;
  } catch (err) {
    try {
      rmSync(tmpAbs, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}

/**
 * Copy a bundled template into `<cwd>/<projectName>`, substituting `{{projectName}}` and
 * `{{sdkVersion}}` in text files.
 *
 * Validation order is deliberate — name, then template, then destination — so nothing touches the
 * filesystem until the inputs are known good.
 *
 * @throws Error with a `code` property: `invalid_project_name`, `unknown_template`, `invalid_dest`
 * (the name escapes `cwd`), `dest_is_symlink` (refused, `force` does not override it),
 * `dest_not_empty` (pass `force`). A missing bundled `templates/` directory throws WITHOUT a code —
 * that is a packaging defect, not user input (EC-C).
 */
export async function scaffold(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  validateNameAndTemplate(opts);
  const cwdAbs = resolve(opts.cwd);
  const destAbs = resolve(cwdAbs, opts.projectName);
  validateDest(cwdAbs, destAbs, opts.projectName, opts.force === true);

  const tmpAbs = `${destAbs}.tmp-${randomBytes(4).toString("hex")}`;
  const sourceAbs = join(resolveTemplatesRoot(), opts.template);
  if (!existsSync(sourceAbs)) {
    throw new Error(
      `Template directory not found: ${sourceAbs}. Ensure the published package included templates/ (EC-C).`,
    );
  }

  const filesWritten = atomicCopy(sourceAbs, tmpAbs, destAbs, opts.projectName);
  return { destAbs, filesWritten };
}

interface SubstitutionVars {
  projectName: string;
  sdkVersion: string;
}

function copyTreeWithSubstitution(srcDir: string, destDir: string, vars: SubstitutionVars): number {
  // For test-friendliness + substitution control, walk the tree ourselves
  // instead of using `cpSync` opaque copy.
  const counter = { count: 0 };
  walk(srcDir, destDir, vars, counter);
  // `cpSync` left in import list for future use (e.g., copying binary assets).
  void cpSync;
  return counter.count;
}

function walk(src: string, dst: string, vars: SubstitutionVars, counter: { count: number }): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      walk(srcPath, dstPath, vars, counter);
    } else if (entry.isFile()) {
      copyFile(srcPath, dstPath, entry.name, vars);
      counter.count += 1;
    }
  }
}

function copyFile(srcPath: string, dstPath: string, name: string, vars: SubstitutionVars): void {
  const content = readFileSync(srcPath, "utf8");
  const ext = name.includes(".") ? `.${name.split(".").pop() ?? ""}` : "";
  const shouldSubstitute =
    SUBSTITUTE_EXTS.has(ext) || name === ".gitignore" || name === ".env.example";
  const out = shouldSubstitute
    ? content
        .replaceAll("{{projectName}}", vars.projectName)
        .replaceAll("{{sdkVersion}}", vars.sdkVersion)
    : content;
  writeFileSync(dstPath, out, "utf8");
}
