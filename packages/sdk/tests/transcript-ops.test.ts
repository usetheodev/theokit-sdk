/**
 * M81 T1.1 — the transcript operations the consumer performed by hand inside the store.
 *
 * ## What exists today, measured
 *
 * `agents/lib/session/backtrack.ts:188` (agent-builder) writes like this:
 *
 * ```ts
 * writeFileSync(dst, body.length > 0 ? body + '\n' : '')
 * ```
 *
 * A **raw** write into the framework's transcript store: no atomicity, no lock, not going through
 * no API at all. That is 243 LoC reimplementing parsing, truncation and writing of a format the framework owns.
 *
 * ## The rule that travels with it (plan ADR D3)
 *
 * `rules/audit-trail-rotation.md § Session transcripts (M60)` establishes a NEVER-delete list:
 * the live pointer, the most recent transcript, and any active registry entry. That rule lives
 * today in the CONSUMER. Moving the operation into the framework without moving the rule would create an API able to
 * erase exactly what the rule protects — the same design that produced `reconcileUpdateGoalStatus`
 * in M80: critical knowledge in the wrong place, enforced by convention.
 *
 * ## Why preserving the SOURCE is the most important assertion
 *
 * A fork that truncates the destination correctly but corrupts the source destroys the user's
 * session. It is the most dangerous operation in this milestone, and the one a "the destination is
 * right" test would not catch.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { JsonlParseError, loadJsonl } from "../src/internal/persistence/jsonl.js";
import {
  forkTranscript,
  LiveTranscriptError,
  readJsonlTail,
} from "../src/internal/persistence/transcript-ops.js";
import { withUmask } from "./helpers/with-umask.js";

const dir = mkdtempSync(join(tmpdir(), "m81-transcript-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Writes a transcript of N records and returns the path. */
function writeTranscriptFile(name: string, n: number): string {
  const p = join(dir, name);
  writeFileSync(p, `${Array.from({ length: n }, (_, i) => JSON.stringify({ i })).join("\n")}\n`);
  return p;
}

describe("M81 T1.1 — transcript operations", () => {
  it("test_forkTranscript_PRESERVES_the_source_intact", () => {
    const src = writeTranscriptFile("source.jsonl", 10);
    const before = readFileSync(src, "utf8");

    forkTranscript(src, join(dir, "fork-a.jsonl"), { beforeRecordIndex: 4 });

    // The assertion that matters most: a fork that truncates correctly but corrupts the source
    // destroys the user's session, and a test focused only on the destination would not catch it.
    expect(readFileSync(src, "utf8"), "the source must survive byte for byte").toBe(before);
  });

  it("test_forkTranscript_cuts_at_beforeRecordIndex", () => {
    const src = writeTranscriptFile("source2.jsonl", 10);
    const dst = join(dir, "fork-b.jsonl");

    forkTranscript(src, dst, { beforeRecordIndex: 4 });

    expect(loadJsonl(dst)).toHaveLength(4);
  });

  it("test_forkTranscript_REFUSES_to_overwrite_an_existing_destination", () => {
    // Overwriting silently is data loss without an error — the worst failure mode for an operation
    // that touches a user's session.
    const src = writeTranscriptFile("source3.jsonl", 5);
    const dst = writeTranscriptFile("already-exists.jsonl", 3);

    // B-079 — was bare `.toThrow()`. Reclassified during triage: `dst` is not in
    // `liveSessionPaths` here, so this does NOT hit `LiveTranscriptError` — it hits
    // `openSync(dst, "wx", …)`, which is Node's own EEXIST `SystemError`. Not our
    // code; pinning `.code` on a raw Node errno buys nothing (same rationale as
    // the item's own stdlib carve-out).
    expect(() => forkTranscript(src, dst, { beforeRecordIndex: 2 })).toThrow(/EEXIST/);
    expect(loadJsonl(dst), "the existing destination must not have been touched").toHaveLength(3);
  });

  it("test_forkTranscript_REFUSES_to_write_over_the_live_pointer", () => {
    // M60's NEVER-delete list, now inside the framework (ADR D3). A TYPED error, not a generic one:
    // the caller needs to tell "protected session" from "disk full".
    const src = writeTranscriptFile("source4.jsonl", 5);
    const live = writeTranscriptFile("session-viva.jsonl", 5);

    expect(() =>
      forkTranscript(src, live, { beforeRecordIndex: 2, liveSessionPaths: [live] }),
    ).toThrow(LiveTranscriptError);
  });

  it("test_readJsonlTail_returns_the_LAST_records", () => {
    const src = writeTranscriptFile("tail.jsonl", 100);
    const tail = readJsonlTail<{ i: number }>(src, { maxRecords: 3 });

    expect(tail).toHaveLength(3);
    expect(
      tail.map((r) => r.i),
      "must be the END, not the beginning",
    ).toEqual([97, 98, 99]);
  });

  it("test_readJsonlTail_reads_BACK_to_front", () => {
    // The point of the operation: a long transcript must not be loaded whole to read its last
    // lines. Without this, `readJsonlTail` would be just a `slice` with a better name.
    // 40,000 records ~ 500 KB — several times the 64 KB chunk. With a fixture smaller than one
    // chunk, the first read would grab the whole file and the test would pass by accident of size,
    // not because the implementation is right.
    const src = writeTranscriptFile("large.jsonl", 40_000);
    const totalBytes = readFileSync(src).length;
    const { bytesRead } = readJsonlTail<{ i: number }>(src, {
      maxRecords: 2,
      _stats: true,
    }) as never;

    expect(bytesRead, "read the whole file — the backwards read is not happening").toBeLessThan(
      totalBytes / 2,
    );
  });

  it("test_loadJsonl_tolerates_a_trailing_partial_line", () => {
    // Crash artifact: the process died mid-write. The complete records before it
    // remain valid and must be recoverable.
    const p = join(dir, "crash.jsonl");
    writeFileSync(p, `${JSON.stringify({ i: 1 })}\n${JSON.stringify({ i: 2 })}\n{"i":3`);

    const rec = loadJsonl(p, { tolerateTrailingPartialLine: true });
    expect(rec).toHaveLength(2);
  });

  it("test_COUNTERPROOF_loadJsonl_WITHOUT_the_option_still_fails", () => {
    // The tolerance is opt-in. As a default, a file corrupted in the MIDDLE would go unnoticed —
    // and then the data loss would be silent instead of loud.
    const p = join(dir, "crash2.jsonl");
    writeFileSync(p, `${JSON.stringify({ i: 1 })}\n{"i":2`);

    // B-079 — was bare `.toThrow()`. `loadJsonl` already throws the typed
    // `JsonlParseError` (jsonl.ts:110) — the item's own triage miscategorized
    // this site as untyped; only the test was under-asserting.
    expect(() => loadJsonl(p)).toThrow(JsonlParseError);
    expect(() => loadJsonl(p)).toThrow(/invalid JSON/);
  });

  it("test_two_concurrent_forks_do_not_corrupt_the_destination", async () => {
    // Concurrent test with an atomic-counter invariant: two forks to the SAME destination => exactly one
    // wins, the other fails with a typed error. Without an atomic write, both would write over each
    // other and the winner would be the last to close the descriptor — with the file possibly half
    // written.
    const src = writeTranscriptFile("source5.jsonl", 20);
    const dst = join(dir, "contended.jsonl");

    const r = await Promise.allSettled([
      Promise.resolve().then(() => forkTranscript(src, dst, { beforeRecordIndex: 5 })),
      Promise.resolve().then(() => forkTranscript(src, dst, { beforeRecordIndex: 9 })),
    ]);

    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    // And the destination must be INTACT — the record count of one of the two, not a mixture.
    expect([5, 9]).toContain(loadJsonl(dst).length);
  });
});

/**
 * M107 T1.2 — the fork destination is born PRIVATE.
 *
 * ## The defect, measured before the change
 *
 * `transcript-ops.ts:84` called `openSync(dst, "wx")` **with no mode argument**, so the file was
 * born `0o666 & ~umask`. Measured on this machine, reproducing that line:
 *
 * ```
 * umask 0o002  ->  destination=0o664      <-- group-WRITABLE
 * umask 0o022  ->  destination=0o644      <-- world-readable
 * umask 0o200  ->  destination=0o466      <-- group E world readable
 * ```
 *
 * A transcript carries the conversation's content. `0o664` is strictly worse than the `0o644` the
 * roadmap claimed — the claim had never been measured. And **no test, anywhere, locked the created
 * file's mode**: that is why the defect was invisible upstream, despite five behaviors of this very
 * fork already being locked.
 *
 * ## Why a DEFAULT and not a knob (D6)
 *
 * A mandatory knob would reach zero consumers by **omission** — the failure mode that
 * `.claude/rules/anti-forgetting-mechanism.md § 3` names as the decisive one. The `mode?` exists to
 * whoever needs a different value; the fix does not depend on anyone remembering it.
 *
 * ## Why there is NO mode reassertion here, unlike `atomicWriteJson`
 *
 * Under `umask 0o200` the destination comes out `0o400` instead of `0o600` — the `umask` cleared the
 * owner's WRITE bit. That is accepted on purpose: the invariant this item buys is *"neither group nor other"*, and
 * `0o400` satisfies it **with room to spare**. Reasserting with `fchmod` would hand back a bit the operator asked
 * to remove them, i.e. the SDK would be loosening the `umask` — the wrong direction in a security
 * fix. In `atomicWriteJson` the reassertion exists because there the mode is an EXPLICIT request
 * from the caller; here it is an SDK default.
 *
 * ## What this block deliberately does NOT test
 *
 * `EEXIST` on an existing destination and the typed refusal of a live session **already have an owner** —
 * `test_forkTranscript_REFUSES_to_overwrite_an_existing_destination` e
 * `test_forkTranscript_REFUSES_to_write_over_the_live_pointer`, above in this file, and both run in the
 * the same command. Repeating them here would be a second oracle over the same fact, which is what
 * `.claude/rules/anti-forgetting-mechanism.md` § 5.6 forbids: two oracles diverge.
 *
 * ## Mutation counter-proof (executed; output in the iteration log)
 *
 * | Mutation in `transcript-ops.ts` | Tests that die |
 * |---|---|
 * | `openSync(dst, "wx", options.mode ?? 0o600)` -> `openSync(dst, "wx")` | the three in this block |
 */
describe("M107 T1.2 — the fork destination is born private", () => {
  const dirMode = mkdtempSync(join(tmpdir(), "m107-fork-mode-"));
  afterAll(() => rmSync(dirMode, { recursive: true, force: true }));

  /** Permission bits, without the node type. */
  const mode = (p: string): number => statSync(p).mode & 0o777;

  function source(name: string): string {
    const p = join(dirMode, name);
    writeFileSync(p, '{"i":0}\n{"i":1}\n');
    return p;
  }

  it("test_the_fork_destination_is_born_0600", () => {
    // Arrange — `umask 0o002` is this machine's, and it is what produced `0o664` (group-writable).
    const src = source("o1.jsonl");
    const dst = join(dirMode, "born-0600.jsonl");

    // Act
    withUmask(0o002, () => forkTranscript(src, dst));

    // Assert
    expect(mode(dst)).toBe(0o600);
  });

  it("test_no_umask_lets_group_or_others_see_the_transcript", () => {
    // Arrange — the item's REAL invariant, across the three measured umasks. Under `0o200` the result is
    // `0o400`: more restrictive than requested, never less (see the docblock).
    const src = source("o2.jsonl");

    for (const mask of [0o002, 0o022, 0o200]) {
      const dst = join(dirMode, `mask-${mask.toString(8)}.jsonl`);

      // Act
      withUmask(mask, () => forkTranscript(src, dst));

      // Assert — zero bits for group and for others, under any umask.
      expect(mode(dst) & 0o077, `umask 0o${mask.toString(8)} leaked permission`).toBe(0);
      expect(mode(dst) & 0o400).toBe(0o400);
    }
  });

  it("test_an_explicit_mode_is_honoured", () => {
    // Arrange — the primitive changes the DEFAULT, not the caller's freedom: a mode more permissive
    // than `0o600` is honored, because imposing policy here would be the primitive deciding for the
    // consumer.
    const src = source("o3.jsonl");
    const dst = join(dirMode, "explicit.jsonl");

    // Act
    withUmask(0o002, () => forkTranscript(src, dst, { mode: 0o640 }));

    // Assert
    expect(mode(dst)).toBe(0o640);
  });

  it("test_two_concurrent_forks_to_the_same_destination_only_one_wins_and_the_winner_is_private", async () => {
    // Arrange — exclusivity (`wx`) and the mode must hold TOGETHER: without this assertion we would
    // prove exclusivity and not privacy.
    const src = source("o4.jsonl");
    const dst = join(dirMode, "contended-mode.jsonl");

    // Act
    const r = await withUmask(0o002, async () =>
      Promise.allSettled([
        Promise.resolve().then(() => forkTranscript(src, dst)),
        Promise.resolve().then(() => forkTranscript(src, dst)),
      ]),
    );

    // Assert (happens-before observation, after the barrier)
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(mode(dst)).toBe(0o600);
  });
});
