/**
 * U-6 — what may this sandbox mode write?
 *
 * The SDK knows: `buildBwrapArgv` binds cwd and /tmp under `workspace-write`, binds nothing under
 * `read-only`, and confines nothing under `danger-full-access`. But it only knows it while BUILDING
 * an argv — there is no way to ask.
 *
 * A consumer needs the answer earlier than that. Tools are scoped before any process is spawned: a
 * file-write tool has to be told which root it may write to, and that decision is made at agent
 * construction time. With nothing to ask, TheoCode kept a second encoding of this same three-mode
 * vocabulary (`sandboxWritePolicy`) — a duplicate that can drift from the argv builder with nothing
 * to catch it (finding SAC-09).
 *
 * The answer is derived from the same constants the builder uses, so the two cannot disagree.
 */
import { describe, expect, it } from "vitest";

import { writableRootsFor } from "../src/sandbox/index.js";

describe("U-6 — writable roots are answerable without spawning", () => {
  it("test_read_only_has_no_writable_root", () => {
    expect(writableRootsFor("read-only", "/proj")).toEqual([]);
  });

  it("test_workspace_write_covers_the_workspace_and_tmp", () => {
    // Exactly what buildBwrapArgv binds: `--bind cwd cwd --bind /tmp /tmp`.
    expect(writableRootsFor("workspace-write", "/proj")).toEqual(["/proj", "/tmp"]);
  });

  it("test_danger_full_access_is_unrestricted", () => {
    // `null` rather than `["/"]`: unrestricted is not "rooted at /", it is the absence of a root.
    expect(writableRootsFor("danger-full-access", "/proj")).toBeNull();
  });

  it("test_the_workspace_root_follows_the_cwd_it_is_given", () => {
    // Anti-vacuity floor: a constant list would satisfy the case above.
    expect(writableRootsFor("workspace-write", "/other")).toEqual(["/other", "/tmp"]);
  });
});
