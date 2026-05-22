# D224 — `Handoff.create(target, { tools: [...] })` whitelists receiver tools for next turn only

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`Handoff.create(target, { tools: ["lookup_invoice"] })` restricts the
receiver to that subset of tools for the FIRST turn after the handoff.
Subsequent receiver-internal turns use the receiver's full tool set.

Implementation reuses D111 (fork's AsyncLocalStorage whitelist pattern).

## Rationale

- Security: a billing agent receiving handoff might only need `lookup_invoice`,
  NOT `delete_account`. Whitelist is the authority gate.
- D111 ALS pattern is already battle-tested in `fork()`; reuse the helper.

Alternatives rejected:

- **Permanent receiver-side whitelist** — overrides receiver's own config;
  too invasive.
- **No whitelist** — security risk for sensitive agents.

## Consequences

- Enables fine-grained authority transfer.
- Constrains: whitelist applies to JUST the post-handoff turn (D111 ALS
  scope); receivers' subsequent turns use their full set.
