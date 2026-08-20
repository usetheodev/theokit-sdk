# `tests/load` — what these files do and do not cover

**Mostly harness scaffolds, with one exception.** B-037 measured that this directory's files
exercise `node:http` and locally-declared generators rather than SDK source, so the directory name
promises load coverage the suite does not have.

| File | Status | Asserts | Placeholder for |
|---|---|---|---|
| `leaky-generators.test.ts` | **real SDK coverage** | that `Task.subscribe`'s iterator releases its subscriber on `break`, on `throw` and on explicit `return()`, and that a hand-driven iterator abandoned without `return()` leaks it | — |
| `1000-concurrent-sse.test.ts` | scaffold | the SSE driver harness sustains 100 connections against a fixture server | T6.2 — 1000 connections at p95 < 200ms against the SDK's SSE wire |
| `slow-consumer-backpressure.test.ts` | scaffold | a local generator drains fully and RSS stays under a generous ceiling | T6.2 — RSS bounds on the SDK stream wire under slow consumers |

`leaky-generators.test.ts` graduated out of the scaffold class in B-105. It previously asked
`FinalizationRegistry` whether a generator had been collected, behind a `globalThis.gc` guard that
was never satisfied, so it reported PASS without running its assertion for its whole life. It now
asserts cleanup through the SDK's own subscriber count, which is deterministic — no GC, no timers,
no window — and is mutation-verified: deleting `TaskIterator.return()` turns it RED.

Its old docblock also had the premise backwards. Breaking out of `for await` does **not** leak: the
iteration protocol calls `.return()` for you, on `break` and on `throw` alike. Only a hand-driven
iterator escapes cleanup.

The two remaining scaffolds each carry an `it.todo` naming their SDK target, owner (B-037) and
sunset (2026-11-19).
