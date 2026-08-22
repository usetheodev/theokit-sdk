# `tests/chaos` — what these files do and do not cover

**These are harness scaffolds. They are not chaos coverage of the SDK.** Read this before citing
anything in this directory as evidence that the SDK survives a fault.

B-037 measured the gap: every file here exercises `node:child_process`, `node:fs` and `node:http`.
None of them imports SDK source or any `@theokit/*` package. The directory name creates the
appearance of resilience coverage the suite does not have — a reader of the test tree would conclude
that OOM, SIGKILL-mid-stream and filesystem partition are covered against the product, and they are
not.

What each file actually asserts today, and the SDK path it is a placeholder for:

| File | Asserts | Placeholder for |
|---|---|---|
| `kill-mid-stream.test.ts` | the process harness observes a SIGKILLed child terminate | T6.3 — SIGKILL mid-tool-loop against a real agent run |
| `oom-recovery.test.ts` | a heap-capped child aborts rather than completing its allocation | T6.5 — OOM in the memory sweep trips the circuit breaker |
| `partition-fs.test.ts` | `mkdir` under a `0o000` parent surfaces `EACCES`/`EPERM` | T6.4 — an unwritable `.theokit/memory` surfaces a typed error |

Each file carries an `it.todo` naming its SDK target, its owner (B-037) and its sunset
(2026-11-19). When the todo is implemented, delete the corresponding row above.

Two assertions in this directory used to be constant-true and have been repaired (B-037):
`expect(result.code !== undefined || result.signal !== null)` — always true, since `code` is
`number | null` — and `expect(typeof process.uptime).toBe("function")`, which cannot fail because a
dead parent would run no assertion at all.
