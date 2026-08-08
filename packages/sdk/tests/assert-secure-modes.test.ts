/**
 * U-4 — the permission gate is exportable.
 *
 * `assertSecureModes` enforces the 0700-dir / 0600-file rule the credential store depends on, and
 * its own docstring names the attack: `mkdirSync(mode)` applies only at creation, so a pre-existing
 * store directory keeps whatever mode it had, and a writable directory lets someone replace the
 * credential file with a symlink to their own — the agent then runs on THEIR account.
 *
 * That reasoning is not specific to this SDK's credential file. It holds for any store a consumer
 * keeps beside it, and consumers do keep them: TheoCode's `~/.theokit/trusted-dirs.json` decides
 * which directories are trusted and which hook command lines are pre-approved, where a hook is
 * `spawn(cmd, { shell: true })`. It was being read with no permission check at all, because the gate
 * that would have caught it was private (finding SAC-01).
 *
 * Exporting it is the difference between every consumer re-deriving the rule — some of them wrongly
 * — and there being one implementation with the attack written next to it.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertSecureModes, CredentialError } from "../src/auth/index.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "theokit-modes-"));
  file = join(dir, "store.json");
  writeFileSync(file, "{}", { mode: 0o600 });
  chmodSync(dir, 0o700);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("U-4 — assertSecureModes is reachable by consumers", () => {
  it("test_a_correctly_permissioned_store_passes", () => {
    // Anti-vacuity floor: a function that always threw would satisfy the cases below.
    expect(() => {
      assertSecureModes(dir, file);
    }).not.toThrow();
  });

  it("test_a_group_or_world_writable_directory_is_refused", () => {
    chmodSync(dir, 0o777);

    expect(() => {
      assertSecureModes(dir, file);
    }).toThrow(CredentialError);
  });

  it("test_a_group_or_world_readable_file_is_refused", () => {
    chmodSync(file, 0o644);

    expect(() => {
      assertSecureModes(dir, file);
    }).toThrow(CredentialError);
  });

  it("test_the_refusal_says_how_to_fix_it", () => {
    chmodSync(dir, 0o777);

    expect(() => {
      assertSecureModes(dir, file);
    }).toThrow(/chmod 700/);
  });
});
