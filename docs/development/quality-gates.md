# Quality Gates

`theokit-sdk` enforces a tiered set of quality gates. Hard gates run automatically on commit, push, and CI. Soft gates produce reports. Manual gates are reviewed in PR via the `quality-review` skill.

The agent-facing contract lives at [`.claude/quality-gates.md`](../../.claude/quality-gates.md); this page is the human-friendly summary.

---

## Running gates locally

```bash
pnpm -w run validate       # full pipeline (all hard gates)
pnpm -w run quality        # just the new quality gates (G5–G10)
pnpm -w run check          # biome lint + format (G2, G9)
pnpm -w run typecheck      # tsc strict (G1)
pnpm -w run test           # vitest (G4)
```

Individual gate scripts:

| Command | What it runs |
| --- | --- |
| `pnpm quality:dead` | `knip` — unused exports, files, deps |
| `pnpm quality:cycles` | `dependency-cruiser` — circular deps + layered architecture |
| `pnpm quality:loc` | `tools/check-loc.mjs` — file LoC budget |
| `pnpm quality:duplication` | `jscpd` — copy-paste detection |
| `pnpm validate:publint` | `publint` — package.json shape |
| `pnpm validate:attw` | `@arethetypeswrong/cli` — types resolution |

---

## Hard gates (block commits + pushes)

| Gate | Tool | Threshold |
| --- | --- | --- |
| **G1** Type safety | `tsc --noEmit` | 0 errors |
| **G2** Lint + format | Biome 2.4 | 0 errors |
| **G3** Public surface | publint + attw | "All good" / "No problems" |
| **G4** Tests pass | Vitest | 100% green-eligible |
| **G5** Dead code | knip | 0 unused exports / files / deps |
| **G6** No cycles | dependency-cruiser | 0 circular deps |
| **G7** Layered arch | dependency-cruiser rules | No types→runtime imports; no src→tests imports; no `referencia/` imports |
| **G8** File LoC | custom script | ≤ 400 LoC per `.ts` (excl. tests) |
| **G9** Function complexity | Biome `noExcessiveCognitiveComplexity` | ≤ 10 cognitive complexity |
| **G10** Duplication | jscpd | ≤ 5% dup, min 50 tokens |
| **G11** Public API ↔ `docs.md` sync | manual (PR review) | Same-PR update required |

---

## Why each gate exists

### G1–G4: foundation
Type safety, lint, public surface, and tests are non-negotiable for an SDK. They lock the contract.

### G5: dead code
Dead code is YAGNI debt that misleads readers. `knip` catches what TypeScript doesn't — unused exports, orphaned files, unused dependencies.

### G6: no cycles
Cycles are a SOLID (DIP) red flag — they indicate a missing abstraction. Refactor by extracting a shared type or interface.

### G7: layered architecture
- `src/types/**` must NOT import runtime code. Types are pure contracts.
- `src/**` must NOT import from `tests/**`. Tests depend on source, not vice versa.
- Nothing in the workspace may import from `referencia/**`. Reference projects are read-only study material.

### G8: file LoC ≤ 400
Empirically, files past ~400 LoC tend to violate SRP. The limit forces healthy decomposition. Test files are excluded — golden suites legitimately accumulate scenarios.

### G9: function complexity ≤ 10
Cognitive complexity (Sonar's variant of cyclomatic) measures how hard a function is to read. Past 10, comprehension drops fast. Refactor by extracting helpers or replacing conditionals with table lookups / polymorphism.

### G10: duplication ≤ 5%
DRY enforced. The Rule of 3 (extract on the third occurrence) is captured by jscpd's `minTokens: 50` — accidental similarity below that is fine.

### G11: contract sync
`docs.md` is the source of truth for the public API. A change to a public type or class without a corresponding `docs.md` update is a silent contract drift — the worst kind.

---

## Hooks

`pnpm install` automatically configures `git config core.hooksPath .githooks` (via the `prepare` script). After install:

| Hook | What runs |
| --- | --- |
| `.githooks/pre-commit` | Biome check (staged) + typecheck — fast (~5s) |
| `.githooks/pre-push` | `pnpm -w run validate` — full pipeline (~30-60s) |

Bypass (emergencies only): `git commit --no-verify`, `git push --no-verify`. Document why in the commit message.

---

## When a gate fails

1. **Read the error**. The tool tells you what's wrong.
2. **Fix the code**, not the threshold. Thresholds are deliberate; weakening them defeats the gates.
3. **If the threshold is genuinely wrong**, open a separate PR that:
   - Edits `.claude/quality-gates.md` (the contract)
   - Edits the tool config
   - Adds a `CHANGELOG.md` entry
   - Includes rationale in the PR description

See [`.claude/quality-gates.md` § "Adjusting a threshold"](../../.claude/quality-gates.md#adjusting-a-threshold).

---

## Manual review (Tier 3)

Use the `quality-review` skill before opening a PR:

```
/quality-review
```

It walks SOLID, DRY, Clean Code, and project-specific design patterns. See `.claude/skills/quality-review.md` for the full checklist.

---

## Next

- [Setup](./setup.md) — first-time install
- [Conventions](./conventions.md) — code style enforced by the gates
- [Testing](./testing.md) — Vitest patterns
- [Releasing](./releasing.md) — Changesets workflow
