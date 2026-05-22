# D197 — `theokit dev` shells out to `tsx --watch`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`theokit dev` spawns `tsx --watch <entry>` via `child_process.spawn` with
`stdio: "inherit"`. Signals (SIGINT, SIGTERM) propagate from parent to
child; if the child doesn't exit in 5s after SIGTERM, the parent sends
SIGKILL. `tsx` is resolved from the CLI package's own node_modules
(NOT the user's project) to guarantee consistent version.

## Rationale

- **`tsx` already solves hot-reload + TS transpile + `.env` loading**.
  Every existing example project uses `tsx --env-file=.env src/index.ts`.
- **Re-implementing watch** would mean parsing TS, restarting the agent
  process gracefully, handling stdin — all solved upstream.
- **Predictable version** — resolving tsx from CLI's tree means
  consumer projects don't need to install tsx themselves; consistency
  across `theokit dev` invocations.

Alternatives rejected:

- **Direct `node --watch`** — Node's built-in watch lacks TS support;
  would force users to add a transpile step.
- **Roll our own watcher** — adds `chokidar` dep + maintenance cost for
  no gain.

## Consequences

- Enables: zero-effort hot-reload matching existing example projects.
- Constrains: `tsx` is a regular dep (~40KB after tree-shake). Same
  trade-off as bundled templates.
