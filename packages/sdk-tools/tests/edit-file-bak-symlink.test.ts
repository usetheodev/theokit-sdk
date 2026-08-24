import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createEditFileTool } from "../src/edit-file.js";
import { textHandler } from "./text-handler.js";

/**
 * CodeQL `js/insecure-temporary-file` (alert #32) on `edit-file.ts:130`.
 *
 * `edit_file` writes a backup at `<path>.bak`, a path an attacker can predict. If that path
 * already exists as a **symlink**, `copyFile` follows it and writes through to wherever it
 * points — so an agent editing a file it is allowed to touch performs a write the caller never
 * authorised, outside the project root.
 *
 * This is a real capability escalation, not a lint: `@theokit/sdk-tools` is the toolkit an agent
 * uses on possibly-untrusted input, and the project-root guard that protects `path` does not look
 * at `<path>.bak` at all.
 */

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "edit-bak-root-"));
  outside = await mkdtemp(join(tmpdir(), "edit-bak-outside-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

it("does not write through a symlink planted at <path>.bak", async () => {
  const target = join(outside, "victim.txt");
  await writeFile(target, "PRISTINE", "utf-8");
  await writeFile(join(root, "editable.txt"), "hello world", "utf-8");
  // The attacker plants the backup path ahead of the edit.
  await symlink(target, join(root, "editable.txt.bak"));
  const tool = createEditFileTool({ projectRoot: root });

  await textHandler(tool)({ path: "editable.txt", old_string: "world", new_string: "there" });

  // The victim outside the project root must be untouched. Asserting its exact content, not
  // merely that the call returned: the whole defect is that the call succeeds.
  await expect(readFile(target, "utf-8")).resolves.toBe("PRISTINE");
});

it("still overwrites a regular .bak, so the guard is not refusing everything", async () => {
  // The accepted case (`testing.md` § 4.2). Without it, a guard that refused every backup path
  // would pass the test above and break `edit_file` for every legitimate second edit — a failure
  // users experience as "the tool is broken", not as "my input was rejected".
  const file = join(root, "editable.txt");
  await writeFile(file, "hello world", "utf-8");
  await writeFile(`${file}.bak`, "STALE BACKUP", "utf-8");
  const tool = createEditFileTool({ projectRoot: root });

  const result = JSON.parse(
    await textHandler(tool)({ path: "editable.txt", old_string: "world", new_string: "there" }),
  );

  expect(result.ok).toBe(true);
  await expect(readFile(`${file}.bak`, "utf-8")).resolves.toBe("hello world");
  await expect(readFile(file, "utf-8")).resolves.toBe("hello there");
});

it("reports the refusal instead of editing without a backup", async () => {
  const file = join(root, "editable.txt");
  await writeFile(join(outside, "victim.txt"), "PRISTINE", "utf-8");
  await writeFile(file, "hello world", "utf-8");
  await symlink(join(outside, "victim.txt"), `${file}.bak`);
  const tool = createEditFileTool({ projectRoot: root });

  const result = JSON.parse(
    await textHandler(tool)({ path: "editable.txt", old_string: "world", new_string: "there" }),
  );

  // Named error, not merely `ok: false` — the agent has to be able to tell this apart from a
  // failed match (`error-handling.md` § 2).
  expect(result.error).toBe("unsafe_backup_path");
  // And the edit itself did NOT happen: a backup the caller asked for could not be made.
  await expect(readFile(file, "utf-8")).resolves.toBe("hello world");
});
