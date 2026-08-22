import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";
import { FsSessionStore } from "../src/internal/persistence/fs-session-store.js";
import { transcriptPath } from "../src/internal/persistence/session-transcript.js";
import { removeTempDirRobustSync } from "./helpers/temp-workspace.js";

/**
 * M93 T4.1 — `appendRecords` appends the delta instead of rewriting the file.
 *
 * It used to be `readTranscript` + `writeTranscript` of the **whole** file, per turn: O(n) of I/O **and**
 * of parsing on every turn, O(n^2) per session. The consumer note records 1.4 MB / 3000 lines over 200
 * turns.
 *
 * Correct because the format **is already append-only** — the `parentUuid` DAG does not depend on line order.
 * And `appendJsonl` **already existed in the package**, with a single caller; the primitive was there and the store
 * ignored.
 */
const reg = (id: string) => ({ uuid: id, type: "user", message: { role: "user", content: id } });

const build = () => {
  const base = mkdtempSync(join(tmpdir(), "m93-"));
  const __baseCleanup1 = base;
  onTestFinished(() => {
    removeTempDirRobustSync(__baseCleanup1);
  });
  const cwd = base;
  const store = new FsSessionStore({ baseDir: base, cwd });
  const filePath = transcriptPath(base, cwd, "ag-1");
  const lineCount = (): number => {
    try {
      return readFileSync(filePath, "utf8")
        .split("\n")
        .filter((l) => l !== "").length;
    } catch {
      return 0;
    }
  };
  return { store, filePath, lineCount };
};

describe("M93 — append incremental", () => {
  it("the file grows EXACTLY by the delta", async () => {
    const { store, lineCount } = build();
    await store.appendRecords("ag-1", [reg("a"), reg("b")] as never);
    const after2 = lineCount();
    await store.appendRecords("ag-1", [reg("c"), reg("d"), reg("e")] as never);
    expect(lineCount() - after2).toBe(3);
  });

  it("re-reading returns everything that was appended, in order", async () => {
    const { store } = build();
    await store.appendRecords("ag-1", [reg("a"), reg("b")] as never);
    await store.appendRecords("ag-1", [reg("c")] as never);
    const reread = (await store.readRecords("ag-1")) as { uuid: string }[];
    expect(reread.map((r) => r.uuid)).toEqual(["a", "b", "c"]);
  });

  it("CONSECUTIVE appends neither duplicate nor lose a record", async () => {
    const { store, lineCount } = build();
    for (let i = 0; i < 3; i++) {
      await store.appendRecords("ag-1", [reg(`x${i}`), reg(`y${i}`)] as never);
    }
    expect(lineCount()).toBe(6);
  });

  it("an EMPTY delta does not touch the file", async () => {
    const { store, filePath } = build();
    await store.appendRecords("ag-1", [reg("a")] as never);
    const before = statSync(filePath).mtimeMs;
    await new Promise((r) => setTimeout(r, 10));
    await store.appendRecords("ag-1", [] as never);
    expect(statSync(filePath).mtimeMs).toBe(before);
  });

  /**
   * The empty-delta guard avoids the **lock**, and that is what makes it observable.
   *
   * The first version of the test above asserted only `mtime` — and the mutant removing the guard
   * **survived**, because with an empty `records` the loop writes nothing anyway. What the
   * guard actually avoids is `mkdir` + `withFileLock`, and the lock leaves a trace: a companion file
   * `<path>.lock`. Without that detail, the guard would be an optimization without proof.
   */
  it("an EMPTY delta never even takes the lock — the guard avoids mkdir + withFileLock", async () => {
    const base = mkdtempSync(join(tmpdir(), "m93-lock-"));
    const __baseCleanup2 = base;
    onTestFinished(() => {
      removeTempDirRobustSync(__baseCleanup2);
    });
    const store = new FsSessionStore({ baseDir: base, cwd: base });
    await store.appendRecords("ag-empty", [] as never);
    const filePath = transcriptPath(base, base, "ag-empty");
    const lockCreated = existsSync(`${filePath}.lock`);
    const dirCreated = existsSync(dirname(filePath));
    expect(lockCreated || dirCreated).toBe(false);
  });

  /**
   * **atomic-counter invariant**: two concurrent `appendRecords` of 3 and 4 records produce
   * exactly 7 lines — none lost, none duplicated. `withFileLock` stays and is what
   * serializes; swapping the operation must not loosen that.
   */
  // NOTE (M93 adversarial review): this test does NOT prove the lock is necessary — removing it
  // leaves the suite green, because `appendJsonl` is synchronous and the `parentUuid` DAG makes
  // interleaving safe. What it proves is the invariant that matters: no line is lost under
  // concurrency. The defense the lock still offers is declared in `fs-session-store.ts` as
  // non-mechanized residue, rather than claimed here as coverage.
  it("two CONCURRENT appendRecords lose no line", async () => {
    const { store, lineCount } = build();
    await Promise.all([
      store.appendRecords("ag-1", [reg("a"), reg("b"), reg("c")] as never),
      store.appendRecords("ag-1", [reg("d"), reg("e"), reg("f"), reg("g")] as never),
    ]);
    expect(lineCount()).toBe(7);
  });

  it("re-reading after a CONCURRENT append returns all 7, with no broken line", async () => {
    const { store } = build();
    await Promise.all([
      store.appendRecords("ag-1", [reg("a"), reg("b"), reg("c")] as never),
      store.appendRecords("ag-1", [reg("d"), reg("e"), reg("f"), reg("g")] as never),
    ]);
    const reread = (await store.readRecords("ag-1")) as { uuid: string }[];
    expect(reread).toHaveLength(7);
  });
});
