# D135 — Async semaphore primitive lives in-house (no `p-limit` / `p-queue` dep)

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`packages/sdk/src/internal/runtime/async-semaphore.ts` implements an
N-permit async-aware semaphore in ~50 LoC. `createSemaphore(permits)`
returns `{ acquire, inFlight, pending }`. `acquire()` resolves to a
release function the caller MUST call exactly once (idempotent on
repeated calls). FIFO queue via `Array.shift()`.

`Agent.batch` and its callers depend on this primitive directly. No
`p-limit`, `p-queue`, `async-sema`, or `semaphore-async-await` dependency
is added.

## Rationale

Tension: "don't reinvent the wheel" (global rule) vs the project posture
of minimal runtime dependencies (only Zod as a peer). Resolution: the
implementation cost (~50 LoC, fully tested) is smaller than the
dependency-evaluation cost (license, transitive deps, maintenance,
maintenance burden when an upstream change breaks our use case).

We also observed that `p-limit` and `p-queue` have semantic differences
(p-limit caps concurrency; p-queue is a priority queue) that would force
us to wrap them anyway. Writing the primitive ourselves keeps the
contract small (`acquire` returns a release fn) and predictable under
fast-check property tests.

Validations:
- T1.1 — 9 unit tests (FIFO order, idempotent release, throws on zero /
  negative / non-integer, inFlight/pending counters).
- T5.1 — 3 fast-check properties × 200 runs each (FIFO order, peak
  in-flight never exceeds permits, release idempotency).

## Consequences

- **Enables:** zero extra runtime deps; behavior fully testable; no
  upstream surprises.
- **Constrains:** we own the primitive — but the contract is small. If
  Node.js ships `AsyncSemaphore` natively, swap is trivial (drop-in).
