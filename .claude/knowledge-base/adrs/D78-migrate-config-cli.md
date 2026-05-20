# D78 — `theokit-migrate-config` CLI standalone

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D44, D74, D77, plan `markdown-config-migration-plan.md`

## Decision

A new standalone binary at `packages/sdk/bin/theokit-migrate-config.mjs`
(espelhando D44 `theokit-migrate-memory`). Converts:

- `.theokit/hooks.json` → `.theokit/hooks/<slug>.md`
- `.theokit/context.json` → `.theokit/context/<slug>.md`
- `.theokit/plugins/<name>/plugin.json` → `.theokit/plugins/<name>/PLUGIN.md`

Default dry-run; `--apply` writes. Behavior:

- **Atomic writes** per file (tmpfile + rename via `atomicWriteText`).
  Crash mid-migration leaves previous MD files intact, never corrupted.
- **Timestamped backups**: originals renamed to `<file>.json.<unix-ts>.bak`.
  Multiple re-runs preserve backup history.
- **Pre-flight abort** if destination MD already exists (avoids
  overwriting manual edits).
- **`--no-backup`** flag skips the `.bak` rename.

## Rationale

Migration friction kills adoption. A CLI that "just works" lets users
migrate in 1 command. Pattern reuse with D44 means users learn it once
(`theokit-migrate-*`) and the SDK ships one consistent binary layout.

Edge-case review surfaced 2 MUST FIX issues that the original sketch
missed:

- **EC-2** — bare `writeFile` would corrupt MD files on crash mid-write.
  Fix: atomic write per file via `atomicWriteText` (helper added in
  T4.1).
- **EC-9** — re-runs of the CLI could overwrite user's manual edits.
  Fix: pre-flight check; abort if destination MD exists.

Plus 1 SHOULD: **EC-19** — `.bak` collision on re-runs. Fix: timestamp
suffix.

Alternatives rejected:

- **Code snippet in docs.md** — puts the work on the user, error-prone.
- **Programmatic API only** — users would call it from a script. A
  binary is more discoverable.

## Consequences

- Enables zero-effort migration: `npx theokit-migrate-config --apply`.
- Constrains: another bin entry to maintain (~250 LoC of CLI). Aceitável —
  D44 set the precedent; users expect the pair.
- Constrains: CLI doesn't dedup with the SDK's runtime loaders — it
  re-implements `JSON.parse` + frontmatter serialization. Aceitável for
  v1.5 — one-shot tool; future v2.x could route through the runtime
  validators if needed.
