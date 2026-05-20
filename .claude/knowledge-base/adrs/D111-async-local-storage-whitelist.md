# D111 — Tool whitelist propagated via `AsyncLocalStorage`, never global mutable

**Date:** 2026-05-19
**Status:** Accepted

## Decision

The per-fork tool whitelist is stored in
`AsyncLocalStorage<Set<string>>` (Node `node:async_hooks`). Two helpers:
- `withToolWhitelist(set, fn)` — runs `fn` inside the ALS context
- `currentToolWhitelist()` — reads the current set (or `undefined`)
- `checkToolWhitelist(toolName)` — returns `{ allowed, reason? }`

The tool-dispatch path (`agent-loop/tool-dispatch.ts:dispatchSingleCall`)
reads `checkToolWhitelist` AFTER the repair middleware and BEFORE
`tools.find` — first gate ahead of plugin veto and file hooks.

CI lint test `no-global-tool-whitelist.test.ts` greps for any
`let _toolWhitelist`-style declaration and fails the build if found.

## Rationale

Python Hermes uses `threading.local()`. JavaScript has no true threads,
but `AsyncLocalStorage` propagates state through `await` chains, including
`Promise.all`. A global mutable `let _whitelist: Set<string> | null` would
let two parallel forks (background review + kanban worker) read each
other's set — the exact corruption the AsyncLocalStorage isolation
prevents.

## Consequences

- **Enables:** N parallel forks with independent whitelists. Nested
  `withToolWhitelist` correctly shadows the outer set (EC-F test).
- **Constrains:** dispatch site grows by one import + one branch. Cost
  is single-digit microseconds per tool call.
