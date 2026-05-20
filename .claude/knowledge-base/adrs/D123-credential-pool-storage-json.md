# D123 — Pool storage = single JSON file at `$THEOKIT_HOME/credential-pool.json`

**Date:** 2026-05-20
**Status:** Accepted

## Decision

Per-workspace pool state persists at `$THEOKIT_HOME/credential-pool.json` via `readVersionedJson` (D62) + `writeVersionedJson` + `withFileLock` (D61). Single JSON file, schema-versioned envelope, atomic write.

## Rationale

Bounded payload (≤10 KB per ~50 keys). JSON is human-inspectable for emergency edits. Matches Hermes's `auth.json` layout under `credential_pool` key. SQLite would over-engineer cross-cutting state that doesn't need queries — `Map<provider, snapshot>` is enough.

## Consequences

- **Enables:** 1-file backup/restore; manual edits; trivial migrations via D62 envelope.
- **Constrains:** O(n) read for `Theokit.credentialPool.list()` — acceptable since pools are bounded ≤10 entries in practice.
