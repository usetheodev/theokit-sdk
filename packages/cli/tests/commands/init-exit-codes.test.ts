import { mkdtempSync, symlinkSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runInit } from "../../src/commands/init.js";

/*
 * #353 — `theokit init` exited 1 ("unknown error") for a symlinked destination.
 *
 * `theokit --help` publishes the contract: `0=success · 1=unknown error · 2=user error`. A CI job
 * branching on 2 (bad input, tell the user) versus 1 (something broke, page someone) routed a
 * symlinked destination to the wrong branch — even though the scaffolder recognises the condition
 * by name and refuses it deliberately.
 *
 * `dest_is_symlink` was one of exactly five coded errors `scaffold` can throw. Four mapped to 2.
 */

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-init-"));
  cwd = process.cwd();
  process.chdir(dir);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(async () => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

it("reports a symlinked destination as user error", async () => {
  symlinkSync("/tmp", join(dir, "my-bot"));

  await expect(runInit("my-bot", { yes: true, template: "minimal" })).resolves.toBe(2);
});

it("reports the other refusals as user error too", async () => {
  // The four that already worked, pinned so a fix that MOVED the gap rather than closing it fails.
  await expect(runInit("Invalid Name!", { yes: true, template: "minimal" })).resolves.toBe(2);
  await expect(runInit("my-bot", { yes: true, template: "no-such-template" })).resolves.toBe(2);
  await expect(runInit("../escape", { yes: true, template: "minimal" })).resolves.toBe(2);
});

it("still succeeds on a clean destination", async () => {
  // The accepted case (`testing.md` § 4.2). A mapping that answered 2 for everything would satisfy
  // every assertion above while reporting a successful scaffold as user error.
  await expect(runInit("fresh-bot", { yes: true, template: "minimal" })).resolves.toBe(0);
});
