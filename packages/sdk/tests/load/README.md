# `tests/load` — what these files do and do not cover

**Mostly harness scaffolds, with one exception.** B-037 measured that this directory's files
exercise `node:http` and locally-declared generators rather than SDK source, so the directory name
promises load coverage the suite does not have.

| File | Status | Asserts | Placeholder for |
|---|---|---|---|
| `leaky-generators.test.ts` | **real SDK coverage** | that `Task.subscribe`'s iterator releases its subscriber on `break`, on `throw` and on explicit `return()`, and that a hand-driven iterator abandoned without `return()` leaks it | — |
| `concurrent-sse-1000.test.ts` | scaffold (leak claim **withdrawn**, B-131) | the SSE driver harness sustains 100 connections against a fixture server, plus a harness-only smoke check (see below) | T6.2 — 1000 connections at p95 < 200ms against the SDK's SSE wire |
| `slow-consumer-backpressure.test.ts` | scaffold | a local generator drains fully and RSS stays under a generous ceiling | T6.2 — RSS bounds on the SDK stream wire under slow consumers |

`leaky-generators.test.ts` graduated out of the scaffold class in B-105. It previously asked
`FinalizationRegistry` whether a generator had been collected, behind a `globalThis.gc` guard that
was never satisfied, so it reported PASS without running its assertion for its whole life. It now
asserts cleanup through the SDK's own subscriber count, which is deterministic — no GC, no timers,
no window — and is mutation-verified: deleting `TaskIterator.return()` turns it RED.

Its old docblock also had the premise backwards. Breaking out of `for await` does **not** leak: the
iteration protocol calls `.return()` for you, on `break` and on `throw` alike. Only a hand-driven
iterator escapes cleanup.

## B-131 — `concurrent-sse-1000.test.ts`'s "does not leak CLOSE_WAIT sockets" claim is WITHDRAWN

That assertion shelled `ss -tnp` against `_harness/sse-driver.ts`, a raw `node:http`/`node:net`
driver with no `src/` production code in it at all. Measured: deleting the driver's own
`client.socket.destroy()` entirely left CLOSE_WAIT at 0 at both 100 and 1000 concurrency, on two
separate runs. Node's `net.Socket` defaults to `allowHalfOpen: false` (completes the FIN handshake
on its own) and the fixture server's `keepAliveTimeout` closes idle sockets — neither depends on any
code this repo owns. The assertion had no power to detect a leak in anything this repo ships.

The real leak-detection duty graduated to `tests/subscription/theokit-subscribe-leak.test.ts`, which
drives `Theokit.subscribe`'s actual SSE and WS transports (the SDK path that genuinely owns
connection lifetime) with `fetch`/`WebSocket` injected via `opts.fetch` / `opts.WebSocket` (B-108) —
no network, no `ss`, no OS auto-close semantics to hide behind. It caught a real gap while it was
being written: the SSE transport's `finally` block called only `reader.releaseLock()`, which per the
WHATWG Streams spec detaches the reader WITHOUT canceling the stream — the underlying `fetch`
response body stayed open on early exit. Fixed in `src/subscription/theokit-subscribe.ts` by also
calling `reader.cancel()`. The WS transport already called `ws.close()` in its own `finally` and
needed no fix; both are now mutation-verified (deleting either cleanup call turns its test RED).

The CLOSE_WAIT check inside `concurrent-sse-1000.test.ts` is kept as a harness smoke check only —
worth knowing if the driver or `socket-monitor.ts` itself breaks, proves nothing about SDK
correctness, and must not be read as a regression guard.

The two remaining scaffolds each carry an `it.todo` naming their SDK target, owner (B-037) and
sunset (2026-11-19).
