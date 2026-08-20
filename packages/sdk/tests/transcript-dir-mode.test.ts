/**
 * T2.4 — the directory that holds transcripts is created as privately as the transcripts are.
 *
 * `appendJsonl` pins the FILE at `0o600` (M93 adversarial review: under `umask 022` a transcript was
 * born `0664`, world-readable). The DIRECTORY it creates was left to the umask, so on a `umask 002`
 * machine it is born `0775` — group-writable. A `0600` file inside a directory others can write is
 * not private: the file can be replaced wholesale, and the replacement's mode is whatever the writer
 * chose.
 *
 * That directory is `~/.theokit`'s subtree, shared with the credential and trust stores. The
 * framework already wrote the diagnosis while fixing a sibling
 * (`@theokit/agents config/trust-store.ts:157-161`): *"the mode argument is a NO-OP on a directory
 * that already exists, and this one is shared with the SDK's transcript root — whoever creates it
 * first sets the permissions."* Whoever creates it first is usually this function, because writing a
 * transcript is what a session does before it ever touches a credential.
 *
 * So `assertSecureModes` was not wrong to demand a private directory. The layout was wrong to
 * produce one that fails it, depending on which code path ran first.
 */
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";
import { appendJsonl } from "../src/internal/persistence/jsonl.js";
import { removeTempDirRobustSync } from "./helpers/temp-workspace.js";

describe("appendJsonl — the directory is as private as the file", () => {
  it("test_the_created_directory_is_not_group_or_world_writable", () => {
    const base = mkdtempSync(join(tmpdir(), "transcript-mode-"));
    const __baseCleanup1 = base;
    onTestFinished(() => {
      removeTempDirRobustSync(__baseCleanup1);
    });
    const path = join(base, "nested", "projects", "session.jsonl");

    appendJsonl(path, { type: "user" });

    const dirMode = statSync(join(base, "nested", "projects")).mode & 0o777;
    expect(
      dirMode & 0o022,
      `directory born ${dirMode.toString(8)} — a 0600 transcript inside a directory others can ` +
        `write can be replaced wholesale, so the file mode buys nothing`,
    ).toBe(0);
  });

  it("test_the_file_mode_is_unchanged_by_this_fix", () => {
    // The M93 guarantee must survive: this task hardens the directory, it does not touch the file.
    const base = mkdtempSync(join(tmpdir(), "transcript-mode-"));
    const __baseCleanup2 = base;
    onTestFinished(() => {
      removeTempDirRobustSync(__baseCleanup2);
    });
    const path = join(base, "session.jsonl");
    appendJsonl(path, { type: "user" });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("test_appending_to_an_existing_directory_still_works", () => {
    // `mkdirSync` with a mode is a no-op on an existing directory. Appending must not start failing
    // because of that — the fix is about how a NEW directory is born.
    const base = mkdtempSync(join(tmpdir(), "transcript-mode-"));
    const __baseCleanup3 = base;
    onTestFinished(() => {
      removeTempDirRobustSync(__baseCleanup3);
    });
    const path = join(base, "session.jsonl");
    appendJsonl(path, { type: "user", i: 1 });
    expect(() => {
      appendJsonl(path, { type: "user", i: 2 });
    }).not.toThrow();
  });
});
