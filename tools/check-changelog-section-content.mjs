#!/usr/bin/env node
/**
 * Refuse a release that would publish a version with no record anywhere (#565).
 *
 * `5.0.0` shipped **ten of twelve packages with an empty CHANGELOG section**. A consumer who
 * installed `@theokit/sdk-tools@0.27.4` and opened its CHANGELOG saw the version they had installed
 * with nothing under it, which reads as "nothing user-visible changed" — a claim nobody made.
 *
 * ## The check the issue asked for, and the one it warned against
 *
 * #565 named the tempting guard and why it is wrong: *"a package with file changes in the release
 * range must have a non-empty CHANGELOG section"* would fail **every** release that exits
 * prerelease mode, including the one that prompted the issue, which lost nothing. On `pre exit` the
 * stable version inherits the number and none of the content, because the entries were already
 * written into the `-next.N` sections of the same version. The content is one section down, in the
 * same file.
 *
 * So this separates two outcomes that look identical from the section alone:
 *
 *   RELOCATED  the body is empty and a prerelease section of the SAME version has content.
 *              The reader is stranded — nothing points down — but nothing is lost. Reported,
 *              never fatal, because failing here would refuse a correct release.
 *
 *   ABSENT     the body is empty and no prerelease section of that version has content either.
 *              This version ships with no record at all. Fatal.
 *
 * ## What it does NOT catch, and why that is deliberate
 *
 * #562 is a different axis and this check does not see it. `@theokit/sdk-memory@0.5.2` had an empty
 * stable section AND its `0.5.2-next.1` — measured while writing this — is full of
 * `Updated dependencies [...]` lines and nothing else. Content exists, so this reports RELOCATED,
 * which is the honest reading of what it looked at.
 *
 * The #562 defect is that a real change touched that package and its changeset named a different
 * one, so it received a dependency-driven bump and never an entry. Detecting THAT means asking
 * whether a package with source changes in the release range has an entry of its own — which is
 * exactly the guard #565 named and rejected, because it fails every correct pre-exit release.
 *
 * Saying so here rather than letting the name imply coverage: a check whose docblock claims a
 * distinction its code does not make is worse than a narrower check, because the gap stops being
 * looked for.
 *
 * ## Why it reads the DIFF rather than the file
 *
 * A published section is a record: immutable, and empty for reasons that were settled when it
 * shipped. Checking every newest section on every pull request would fire forever on history
 * nobody may edit.
 *
 * The sections this pull request ADDS are the ones still in play. On the changesets Version PR that
 * is precisely the set about to be published, which is the last moment the record can still be
 * fixed. On an ordinary pull request the set is empty and this exits silently — but says so, per
 * CONTRIBUTING § "A silent gate reports absence it never checked".
 *
 * Usage: node tools/check-changelog-section-content.mjs [base-ref] [head-ref]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolved from THIS FILE, not the caller's cwd.
 *
 * The same reasoning `check-no-reconsumed-changesets.mjs` documents: every git call below names
 * `packages/`, git resolves a pathspec relative to the working directory, and running from
 * `packages/sdk` would ask about `packages/sdk/packages/` — finding nothing, which for this guard
 * would read as "no sections added" and pass.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A `## <version>` heading, capturing the version. Sub-headings inside a body are `###`. */
const SECTION_RE = /^## (\S+)\s*$/;

function git(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Every `packages/*​/CHANGELOG.md` version heading this diff ADDS, as `{ file, version }`.
 *
 * `--unified=0` so the added lines are only the added lines: a heading that merely appears as
 * context around someone else's edit is not a section this change introduces.
 */
export function addedSections(base, head) {
  let diff;
  try {
    diff = git([
      "diff",
      "--unified=0",
      "--end-of-options",
      `${base}...${head}`,
      "--",
      "packages/*/CHANGELOG.md",
    ]);
  } catch (err) {
    // An unreadable ref must REFUSE, not report clean — the same rule
    // `check-no-reconsumed-changesets.mjs` states for itself. An empty list here means "nothing to
    // check", so a ref this checkout cannot resolve would pass as a clean release.
    throw new Error(
      `could not diff \`${base}...${head}\` — the repository cannot resolve one of them. Fetch ` +
        `first (\`git fetch origin\`), or pass refs this checkout has. Reporting a release as ` +
        `clean because a ref was unreadable is the one answer this guard must never give.\n` +
        `  git said: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
    );
  }

  return parseAddedSections(diff);
}

/** The diff walk, split out so `addedSections` is the git call and this is the parsing. */
function parseAddedSections(diff) {
  const out = [];
  let file = null;
  for (const line of diff.split("\n")) {
    const header = /^\+\+\+ b\/(packages\/[^/]+\/CHANGELOG\.md)$/.exec(line);
    if (header !== null) {
      file = header[1];
      continue;
    }
    if (file === null || !isAddedLine(line)) continue;
    const section = SECTION_RE.exec(line.slice(1));
    if (section !== null) out.push({ file, version: section[1] });
  }
  return out;
}

/** An added content line — `+++` is the file header, not content. */
const isAddedLine = (line) => line.startsWith("+") && !line.startsWith("+++");

/** The non-blank lines between `## <version>` and the next `## `, or `null` when absent. */
export function sectionBody(text, version) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => SECTION_RE.exec(l)?.[1] === version);
  if (start === -1) return null;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (SECTION_RE.test(line)) break;
    if (line.trim() !== "") body.push(line);
  }
  return body;
}

/** Every `<version>-<tag>.<n>` heading present in the file, for one stable `version`. */
export function prereleaseSectionsOf(text, version) {
  return text
    .split("\n")
    .map((l) => SECTION_RE.exec(l)?.[1])
    .filter((v) => v?.startsWith(`${version}-`) === true);
}

function classify(file, version) {
  const path = join(REPO_ROOT, file);
  if (!existsSync(path)) return { verdict: "gone", file, version };
  const text = readFileSync(path, "utf8");

  const body = sectionBody(text, version);
  // Added by the diff and absent from the file: the section was added and then removed again in
  // the same range. Nothing ships from it.
  if (body === null) return { verdict: "gone", file, version };
  if (body.length > 0) return { verdict: "documented", file, version, lines: body.length };

  const carriers = prereleaseSectionsOf(text, version).filter(
    (pre) => (sectionBody(text, pre) ?? []).length > 0,
  );
  return carriers.length > 0
    ? { verdict: "relocated", file, version, carriers }
    : { verdict: "absent", file, version };
}

function main() {
  const base = process.argv[2] ?? "origin/main";
  const head = process.argv[3] ?? "HEAD";

  let added;
  try {
    added = addedSections(base, head);
  } catch (err) {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }

  if (added.length === 0) {
    console.log(
      `✓ [changelog-content] no package CHANGELOG section added between ${base} and ${head} — ` +
        `nothing to check (this fires on the Version PR, where the sections are written)`,
    );
    return;
  }

  const results = added.map((s) => classify(s.file, s.version));
  const absent = results.filter((r) => r.verdict === "absent");
  const relocated = results.filter((r) => r.verdict === "relocated");
  const documented = results.filter((r) => r.verdict === "documented");

  console.log(
    `[changelog-content] ${String(added.length)} section(s) added: ` +
      `${String(documented.length)} documented, ${String(relocated.length)} relocated, ` +
      `${String(absent.length)} empty`,
  );

  for (const r of relocated) {
    // Reported, never fatal. The content exists in the same file and a reader who scrolls one
    // section finds it — materially milder than an undocumented change, and failing here would
    // refuse every correct release that exits prerelease mode.
    console.log(
      `… ${r.file} § ${r.version} is empty, but ${r.carriers.join(", ")} carr${
        r.carriers.length === 1 ? "ies" : "y"
      } the entries. Nothing is lost; nothing points there either.`,
    );
  }

  if (absent.length === 0) {
    console.log(`✓ [changelog-content] every added section has a record`);
    return;
  }

  reportAbsent(absent);
  process.exit(1);
}

/** The refusal, split out so `main` reads as the decision and this as the message. */
function reportAbsent(absent) {
  console.error(`\n✗ a version would publish with NO record, here or in its prereleases\n`);
  for (const r of absent) console.error(`    ${r.file} § ${r.version}`);
  console.error(
    `\n  An empty section reads as "nothing user-visible changed", which is a claim nobody made.\n` +
      `  Cause, usually: the changeset named some packages and not this one, so it got a\n` +
      `  dependency-driven bump and no entry (#562).\n` +
      `  Fix: add a changeset naming this package, then re-run \`changeset version\`.\n`,
  );
}

if (process.argv[1]?.endsWith("check-changelog-section-content.mjs")) {
  main();
}
