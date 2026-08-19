/**
 * B-117 — the two remaining containment guards judge a symlink by its NAME.
 *
 * This is the same defect, in the same package, for the third time: B-042 fixed it in a consumer,
 * B-115 fixed one copy here. Both survivors close the sibling-directory half — each appends a
 * separator, so `<root>-evil` is refused — and neither closes the other half. A symlink whose name
 * sits inside the root and whose target does not passes any comparison made before symlink
 * resolution.
 *
 * MEASURED before writing this file, rather than deduced from reading: a link at `<root>/escape`
 * pointing at a sibling directory makes `resolve(root, "escape/secret.txt")` a path that both
 * guards accept, while `realpathSync` of it lands outside. Both guards are reachable —
 * `safePathJoin` from the plugin manager and the MCP client, `isPathInside` from `memory_get`.
 *
 * The fix consumes `internal/runtime/context/path-containment.ts` rather than making a third copy.
 * That is DRY about the RULE, which is the point: three copies at three strengths is how the first
 * two drifted apart.
 */

import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PathTraversalError, safePathJoin } from "../src/internal/security/path-guard.js";
import { createTempWorkspace, type TempWorkspace } from "./helpers/temp-workspace.js";

let workspace: TempWorkspace;
let root: string;
let outside: string;

beforeEach(async () => {
  workspace = await createTempWorkspace();
  // realpath the workspace itself: on macOS `/tmp` is a symlink, and a test that did not resolve it
  // would fail for that reason rather than for the one it is about.
  const dir = realpathSync(workspace.cwd);
  root = join(dir, "root");
  outside = join(dir, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "a file the root must not reach");
  symlinkSync(outside, join(root, "escape"));
});

afterEach(async () => {
  await workspace.cleanup();
});

describe("safePathJoin — a symlink out of the root is refused", () => {
  it("test_a_path_through_a_symlink_leaving_the_root_is_refused", () => {
    // The escape. `<root>/escape/secret.txt` is lexically inside and physically outside.
    //
    // B-079. This asserted a bare `toThrow()`. Measured: replacing the guard's
    // `throw new PathTraversalError(...)` with `throw new TypeError("boom")` leaves all six tests in
    // this file GREEN. So a containment test could not distinguish "refused this escape" from "broke
    // on everything" — and on a security guard those are opposite outcomes: the second means the
    // function rejects legitimate paths too, which is an outage, not a defence.
    //
    // The type is the property. The message matcher is weaker than it looks and says so here rather
    // than in a comment nobody re-measures: `PathTraversalError`'s message carries BOTH the attempted
    // path and the resolved one, and both end in `escape/secret.txt`, so this regex cannot tell them
    // apart. Measured — dropping the attempted path from the message leaves all six green; dropping
    // both fails. It pins "the message names the path somehow", which is worth keeping and is not
    // the stronger claim an earlier version of this comment made.
    expect(() => safePathJoin(root, "escape/secret.txt")).toThrow(PathTraversalError);
    expect(() => safePathJoin(root, "escape/secret.txt")).toThrow(/escape\/secret\.txt/);
  });

  it("test_a_symlinked_directory_itself_is_refused", () => {
    // B-079. Same measurement, same repair.
    expect(() => safePathJoin(root, "escape")).toThrow(PathTraversalError);
  });

  it("test_an_ordinary_path_inside_the_root_is_still_allowed", () => {
    // Anti-vacuity: refusing everything would satisfy both cases above, and would break every
    // legitimate plugin entry point and MCP working directory.
    mkdirSync(join(root, "real"));
    writeFileSync(join(root, "real", "file.txt"), "fine");

    expect(safePathJoin(root, "real/file.txt")).toBe(join(root, "real", "file.txt"));
  });

  it("test_a_symlink_that_stays_inside_the_root_is_allowed", () => {
    // The other half of anti-vacuity, and the case a naive "refuse all symlinks" fix would break:
    // a link is only a problem when its TARGET leaves.
    mkdirSync(join(root, "real"));
    writeFileSync(join(root, "real", "file.txt"), "fine");
    symlinkSync(join(root, "real"), join(root, "alias"));

    expect(() => safePathJoin(root, "alias/file.txt")).not.toThrow();
  });

  it("test_the_root_itself_is_still_allowed", () => {
    // Preserved deliberately. The shared `insideRoot` answers FALSE for the root itself — correct
    // for its own caller, wrong here, where `safePathJoin(base)` with no parts must return `base`.
    // Consuming the shared rule must not quietly change this.
    expect(safePathJoin(root)).toBe(root);
  });

  it("test_the_sibling_directory_escape_stays_refused", () => {
    // The half that already worked. Keeping it pinned means the fix cannot trade one escape for
    // the other — which is exactly what happened when these guards were fixed one at a time.
    mkdirSync(`${root}-evil`);

    expect(() => safePathJoin(root, `../${"root"}-evil/x`)).toThrow(PathTraversalError);
  });
});
