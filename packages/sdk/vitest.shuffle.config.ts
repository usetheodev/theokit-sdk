import { defineConfig } from "vitest/config";

import { ROADMAP_ONLY_SUITES, SHARED_TEST_OPTIONS } from "./vitest.config.js";

// Order-shuffle probe config — B-059. Runs the same suite the default `pnpm test`
// gate runs, but with file-level parallelism restored and execution order shuffled,
// so any isolation leak the strict-serial default gate suppresses gets a chance to
// surface. Invoke from the repository root with `pnpm test:order-shuffle`; wired
// into a scheduled (non-blocking) CI job, never into the push/PR gate.
//
// MEASURED 2026-08-20 against a clean tree (668 files / 4904 cases, three baseline
// runs): `fileParallelism: true` ALONE (keeping `maxConcurrency: 1`) reproduced the
// clean baseline exactly across two runs — zero failures. The two leaks the default
// gate's comment names (`process.env.HOME` mutation, the process-wide agent
// registry) are the ones B-120/B-117 already closed, and file-level parallelism
// alone does not reopen either.
//
// Restoring `maxConcurrency` too (this file uses vitest's default) plus
// `sequence.shuffle: true` found a REAL, reproducible race the default gate's
// `maxConcurrency: 1` was suppressing — not the leak the comment named, a different
// one: `tests/internal/memory/adapters/embedding-wire-contract.test.ts` keeps a
// file-level mutable `probeCounter` shared by every `it()` in its describe block
// (see that file's own doc-comment on the counter). Under intra-file concurrency,
// concurrent `it()` bodies race the increment, so one test's captured HTTP request
// carries another test's `probe-N` text. Reproduced 3 times out of 3 concurrent+
// shuffled runs (varying which of the 3 non-`jina` cases lost the race each time —
// the `jina` case is not always among them, consistent with a genuine race rather
// than a fixed ordering bug).
//
// THAT RACE IS FIXED. The shared counter was removed; `vitest.config.ts` (see the
// note beside `maxConcurrency`) records the fix and the re-measurement — 3/3 clean at
// maxConcurrency 5 + shuffle, 5/5 on the file alone — and the test file's own
// doc-comment says the counter is gone. This paragraph is kept in the past tense
// rather than deleted: it is the record of what this probe caught, which is the
// argument for running it. What it must NOT do is read as an open race, which it did.
//
// THE SECOND SIGNAL WAS REAL, and its follow-up took four months. `ENOTEMPTY` on a
// temp-dir `rmdir` in `tests/golden/runtime/memory-auto-write.golden.test.ts` appeared
// once in three shuffled runs here and was flagged unconfirmed. It reproduced on
// 2026-09-01 in an ORDINARY full run — every test passing, the run failing at close —
// and the cause is one the shuffle axis did not need: the SDK's fire-and-forget
// session-summary and registry writes land after the call a test awaited, so `rm`
// walks the directory, the writer creates a file, and `rmdir` fails. The global
// teardown in `vitest.setup.ts` removed each test's HOME sandbox with a bare
// `rmSync`, while `tests/helpers/temp-workspace.ts` documented at length why
// `maxRetries` is load-bearing for exactly that call. It now uses the same helper.
//
// Stated honestly: that fix is not PROVEN to close this signal. The race could not be
// reproduced synthetically — 22 trials with an in-process and then a separate writer
// process failed to make a bare `rmSync` fail. What is certain is that two removers
// of the same kind of directory disagreed, and the one without the documented policy
// is the one that failed. If this probe surfaces ENOTEMPTY again, that is the thread.
//
// This file intentionally does NOT fix a leak it surfaces — per this item's DoD, the
// job is to surface them periodically, not to silently work around them in the config
// that decides what merges. Recording their fate here is a different thing, and is
// what stops the probe's own comment from mis-stating the tree.
export default defineConfig({
  test: {
    ...SHARED_TEST_OPTIONS,
    fileParallelism: true,
    sequence: { shuffle: true },
    // Undo the default gate's `maxConcurrency: 1` — that is the axis that actually
    // hid the embedding-wire-contract.test.ts race (see measurement note above).
    maxConcurrency: 5,
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", ...ROADMAP_ONLY_SUITES],
  },
});
