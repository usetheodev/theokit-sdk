# D37 — Chaos test methodology for persistence validation

**Status:** Decided
**Date:** 2026-05-17

## Decision

Persistence chaos testing is implemented as a bash + Node.js
harness that, for each iteration, spawns a child SDK process via tsx,
lets it send messages to a local agent, kills the process with
`SIGKILL` at a randomized time mid-execution, and then validates that
the on-disk registry remains parseable JSON without half-written
entries. Each iteration uses an isolated workspace directory under
`/tmp/chaos-victim-<iter>/`. Failed iterations produce a tar.gz
artifact snapshotting the `.theokit/` directory for post-mortem.

The default run is 100 iterations with kill delays uniformly randomized
in `[500, 3500]` ms. CI runs the suite nightly; pre-commit hooks do NOT
run it (too slow). The harness lives in `tools/chaos-persistence.sh`
and `tools/chaos-persistence-victim.mjs`.

## Rationale

`kill -9` is the most hostile signal — no cleanup hooks, no graceful
shutdown, no opportunity for in-flight writes to flush. If the registry
survives 100 hits at random points across the agent lifecycle, the
restart-proof claim from D17–D21 is validated empirically, not just by
design intent.

Alternatives considered:

- **Chaos-monkey framework** (e.g., `chaos-toolkit`): overkill for a
  single-process scenario; introduces a dep we don't otherwise need.
- **In-process simulated crashes**: doesn't exercise the real
  OS-signal path, misses race conditions around `replaceFileAtomic`.
- **Network-level chaos**: out of scope; persistence is local-only in
  v1.1.

Bash + Node child processes are sufficient and dependency-free.
Snapshots of failures are critical because the next time someone
re-runs the suite, the random delays will be different — without the
artifact, the failure can't be reproduced.

## Consequences

- Suite is slow (5–10 minutes for 100 iterations) and not part of
  pre-commit. Runs in CI nightly cron, or manually before a release.
- Child MCP servers spawned by the victim may orphan when the victim
  is killed (`kill -9` doesn't reach the grandchild). The suite
  documents a cleanup step (`pkill -f modelcontextprotocol`) at the
  end of each batch. Documented limitation, not a blocker.
- Failed iterations create tar.gz artifacts in /tmp — the suite
  documents space requirements (worst case ~500 MB for 100 fails) and
  recommends a dedicated CI environment.
- The suite is reusable for future SDK versions to detect regression
  in persistence guarantees.
