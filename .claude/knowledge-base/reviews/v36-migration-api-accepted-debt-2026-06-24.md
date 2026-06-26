# V3-6 — Decision Record: programmatic migration API → ACCEPTED DEBT (formal)

**Date:** 2026-06-24 · **Milestone:** V3-6 (ROADMAP-v3) · **Repo:** `theokit` (would-be) · **Decision:** **DO NOT BUILD — accepted as permanent documented debt.**
**Decided by:** project owner (explicit, 2026-06-24) · **Status:** V3-6 closed-as-wontbuild (not closed-as-built).

## What V3-6 proposed

Expose a runtime, idempotent programmatic migration API (`ensureColumn` / `migrate`) in the `theokit` framework, callable in-process (not via the `theokit db push` dev CLI), so a consumer can ALTER-add columns on boot. The executable spec is theocode's hand-rolled helper:

```ts
// theocode/server/db/index.ts:62 — the entire pattern, ~6 lines
function ensureColumn(sqlite, table, column, definition) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column))
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}
```

## Decision: accept as permanent debt (honor YAGNI)

The decision is **not to build** the framework API, and to record `migration-ensure-column` as **accepted debt** in theocode's anti-reinvention baseline — exactly the escape hatch the ROADMAP-v3 V3-6 entry names: *"pode ficar como accepted debt permanente — o hand-roll é correto e mínimo; só vale se outros consumidores pedirem."*

## Rationale

1. **YAGNI — the V3 unbreakable principle.** ROADMAP-v3 § 0: *"Nenhum milestone adiciona um primitivo especulativo (YAGNI); cada um existe porque o theocode tem o hand-roll que o prova."* For every prior V3 milestone the framework exposed a primitive a real consumer needed AND whose hand-roll was non-trivial / divergent / a security gap (shell-guard) / a behavior gap (compaction). V3-6 is different: the hand-roll is a **correct, minimal ~6-line idempotent PRAGMA+ALTER** — there is nothing to harden, no security/behavior gap, no divergence to reconcile.
2. **Single consumer, low value.** ROADMAP-v3 V3-6 itself: **Valor: Baixo**, *"Concluído quando (SE valer)"*, *"só vale se outros consumidores pedirem."* Exactly one consumer (theocode) has the pattern; no second consumer has requested it. Adding a public framework migration API for one consumer whose hand-roll is already minimal is the speculative generalization the roadmap warns against.
3. **A real migration API is a much larger surface than `ensureColumn`.** A credible framework migration primitive implies versioned migrations, ordering, up/down, a ledger table, multi-dialect concerns — i.e. reinventing a migration tool (Drizzle/Prisma/Kysely already exist; Unbreakable Rule 9). Shipping a thin `ensureColumn` wrapper as "the migration API" would be a misleading half-primitive; shipping the full thing is unjustified for one consumer. Both options are worse than the status quo.
4. **The status quo is correct and minimal.** theocode's `ensureColumn` works, is idempotent, is covered by theocode's own boot path, and carries no maintenance risk. KISS favors leaving it.

## Consequences

- `theokit` ships **no** programmatic migration API in V3 scope. No code, no dependency, no version bump, no npm publish.
- theocode's `ensureColumn` stays as-is. The `migration-ensure-column` baseline entry is reclassified from "reinvention gap" to **accepted debt** (a documented, conscious decision — not an un-tracked gap). Baseline does NOT reach 0, by design; the remaining entry is debt-with-rationale, which the V3 "completa" verdict explicitly permits (*"cada reinvenção restante é accepted debt documentado, não gap"*).

## Revisit conditions (when this decision should be reopened)

Build the framework migration API only when **at least one** holds:
- A **second** independent consumer needs runtime schema evolution (the "outros consumidores pedirem" trigger).
- theocode's schema evolution outgrows `ensureColumn` (needs ordering / down-migrations / a ledger) — at which point adopting a mature migration library (Rule 9), not a bespoke `theokit` API, is the first option to evaluate.

## Validation

No software validation applies — this milestone ships **no code**. (The goal's `chrome-devtools-mcp` validation requirement was explicitly waived by the owner: V3-6 has no browser/HTTP/UI surface — it is in-process SQLite DDL — so a browser driver has nothing to load or assert; driving one would be fabricated validation. Honest validation for a hypothetical DB API would be a real-SQLite integration test, which is moot since the API is not being built.)

## V3 closure

With V3-6 resolved as accepted-debt-formal, **all V3 milestones are resolved**: V3-0..V3-5 shipped + adopted; V3-6 consciously deferred with rationale. This satisfies the ROADMAP-v3 § 2 verdict: *"cada reinvenção restante é accepted debt documentado, não gap."*
