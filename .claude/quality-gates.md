# Quality Gates — Contract

Source of truth for what blocks a commit, a push, and a PR in `theokit-sdk`. Treat this file the same way you treat `docs.md`: it is the contract. Drift between this file and the actual scripts is a bug — fix the scripts, then the doc.

The user-facing guide lives at [`docs/development/quality-gates.md`](../docs/development/quality-gates.md); this file is the agent-facing spec.

---

## Tiered model

| Tier | When | Action | Owner |
| --- | --- | --- | --- |
| **Tier 1 — Hard** | pre-commit (light subset) + pre-push (full) + CI | **BLOCK** | Tooling |
| **Tier 2 — Soft** | On demand via `pnpm quality:report` | **WARN** | Tooling |
| **Tier 3 — Manual** | PR review | Checklist + `quality-review` skill | Humans + AI |

Hard gates run automatically. Soft gates produce reports. Manual gates require explicit reasoning during code review.

---

## Tier 1 — Hard gates

Each gate has: **what it enforces**, **principle covered**, **tool**, **threshold**, **how to override** (only in exceptional cases).

### G1. Type safety

- **Enforces**: TypeScript strict mode passes.
- **Principle**: Sound types are a load-bearing constraint of the public contract.
- **Tool**: `tsc --noEmit` via `pnpm typecheck`.
- **Threshold**: **0 errors**.
- **Override**: Never. Fix the types or fix the code.

### G2. Lint + format

- **Enforces**: Code matches Biome 2.4 rules (recommended + project additions).
- **Principle**: Clean Code (naming, formatting, simple control flow).
- **Tool**: Biome via `pnpm check`.
- **Threshold**: **0 errors**. Warnings allowed for `suspicious/noExplicitAny` only.
- **Override**: Inline `// biome-ignore lint/<group>/<rule>: <justification>` with a real reason. Linter will flag unused suppressions.

### G3. Public surface stability

- **Enforces**: `package.json` `exports`, `types` resolution, and dual ESM/CJS shape are valid.
- **Principle**: SDK contract stability across runtimes.
- **Tools**: `publint` and `@arethetypeswrong/cli`.
- **Threshold**: publint `All good`, attw `No problems` (with `--ignore-rules no-resolution` — Node 10 is out of scope).
- **Override**: Adjust the `exports` map in `packages/sdk/package.json`. Never silence publint.

### G4. Tests pass

- **Enforces**: Every green-eligible test passes.
- **Principle**: TDD.
- **Tool**: Vitest via `pnpm test`.
- **Threshold**: 100% of green-eligible tests pass. The split is enforced by `vitest.config.ts` `test.exclude`:
  - **Green-eligible (run by default)**: `tests/smoke.test.ts`, `tests/golden/hygiene.golden.test.ts`. These MUST pass on every commit.
  - **RED roadmap (excluded by default, run via `pnpm test:roadmap`)**: `tests/contract/*.contract.test.ts`, `tests/golden/*.golden.test.ts` (except hygiene). These are pinned specs waiting for the runtime adapter — visible in `pnpm test:roadmap` for outstanding-work tracking, but they do NOT block commits.
- When a runtime adapter ships and a RED suite turns green, **remove its exclusion from `vitest.config.ts`** in the same PR — that promotes it back into the default `pnpm test` gate.
- **Override**: Never. If a green-eligible test fails, fix it. If a RED suite turns green by accident, remove its exclusion immediately.

### G5. Dead code

- **Enforces**: No unused exports, files, or dependencies.
- **Principles**: DRY, YAGNI.
- **Tool**: `knip`.
- **Threshold**: **0 unused exports / files / dependencies**.
- **Override**: Add an entry to `knip.json` `ignore` with a `// reason: ...` comment in this doc. Stub APIs that are scheduled to be wired up are allowed; pre-existing unused code is not.

### G6. No dependency cycles

- **Enforces**: Module dependency graph has no cycles.
- **Principle**: SOLID (DIP) — cycles indicate broken abstraction.
- **Tool**: `dependency-cruiser`.
- **Threshold**: **0 circular dependencies**.
- **Override**: Never. Break the cycle by extracting a type, an interface, or a smaller module.

### G7. Layered architecture

- **Enforces**: Import boundaries between layers.
- **Principle**: SOLID (DIP), Clean Code.
- **Tool**: `dependency-cruiser` rules.
- **Rules**:
  - `src/types/**` MUST NOT import from any non-`src/types/**` runtime module.
  - `src/**` MUST NOT import from `tests/**`.
  - Nothing in the workspace MAY import from `referencia/**`.
- **Override**: Never. These boundaries define the architecture.

### G8. File LoC budget

- **Enforces**: No `.ts` file exceeds **400 logical lines of code** (non-empty, non-comment, non-block-comment).
- **Principles**: SRP, Clean Code.
- **Tool**: `tools/check-loc.mjs` via `pnpm quality:loc`.
- **Threshold**: **≤ 400 LoC per file**, excluding `**/*.test.ts` and `**/*.test-d.ts`.
- **Override**: Split the file. There is no project-wide exception. Test files are excluded because golden suites legitimately accumulate scenarios.

### G9. Function complexity

- **Enforces**: Cognitive complexity stays manageable.
- **Principle**: SRP, Clean Code (SLAP — Single Level of Abstraction).
- **Tool**: Biome `complexity/noExcessiveCognitiveComplexity`.
- **Threshold**: **≤ 10 cognitive complexity** per function.
- **Override**: Refactor (extract function, replace nested branches with table lookup, replace conditional with polymorphism). A `biome-ignore` with `CLEAN-CODE-EXCEPT: <reason>` is allowed at most once per file and requires a follow-up issue.

### G10. Duplication

- **Enforces**: No copy-paste blocks above the threshold.
- **Principle**: DRY.
- **Tool**: `jscpd`.
- **Threshold**: **≤ 5% duplication overall**, min **50 tokens**, min **5 lines**. Golden JSON fixtures excluded.
- **Override**: Refactor into a shared helper. If duplication is structurally similar but semantically different (e.g. two unrelated validators), document with a `// JSCPD-EXCEPT: <reason>` block comment.

### G11. Public API ↔ `docs.md` sync (manual until automated)

- **Enforces**: Any change to a public-surface file (`src/index.ts`, `src/agent.ts`, `src/cron.ts`, `src/theokit.ts`, `src/errors.ts`, `src/types/*`) ships with a corresponding `docs.md` update in the same PR.
- **Principle**: Contract-source-of-truth alignment.
- **Tool**: Currently **manual** (PR checklist in `quality-review` skill). Phase 2 automates via `tools/check-docs-sync.mjs`.
- **Threshold**: PR cannot land without both legs updated.
- **Override**: Never.

---

## Tier 2 — Soft gates

Run with `pnpm quality:report` (Phase 2). Produces a report; does not block.

| # | Gate | Tool | Threshold |
| --- | --- | --- | --- |
| S1 | Test coverage | `vitest --coverage` | ≥ 80% line coverage post-runtime-impl (today 100% stubs — skip until adapters ship) |
| S2 | Bundle size | `size-limit` (Phase 2) | ESM ≤ 30 KB, CJS ≤ 35 KB |
| S3 | TODO without ticket | grep | warn on `// TODO` lines without `(#xxx)` reference |
| S4 | Dependency CVEs | `pnpm audit` | warn on high-severity advisories in prod deps |

---

## Tier 3 — Manual review gates

Invoke the `quality-review` skill (see `.claude/skills/quality-review.md`) when reviewing a PR. Each item is a yes/no judgment with a justification when "no" is the right answer.

### SOLID

- **SRP**: Every class / module has exactly one reason to change. Names don't contain "And".
- **OCP**: New behaviors are additions (new file, new strategy), not edits to growing switch/case tables.
- **LSP**: Subclasses pass every test of their base class without modification.
- **ISP**: Interfaces have ≤ 7 members; larger interfaces are split or justified.
- **DIP**: Concrete I/O lives behind interfaces in `src/internal/` or `src/runtime/`. Domain code depends on types, not on `fetch`, `fs`, `path` directly.

### DRY

- No business rule is implemented twice (Rule of 3 — extract on the 3rd occurrence).
- No structural copy-paste beyond what jscpd allows.

### Clean Code

- Functions ≤ **50 LoC**, ≤ **4 parameters**, ≤ **3 nested levels**.
- Boolean parameters ≤ 2 per function — prefer two functions over a flag arg.
- No primitive obsession — wrap repeated triples of `(name, value, unit)` in a type.
- Names are intention-revealing; no `data`, `tmp`, `helper`, `mgr`, `util` without specifics.
- Comments explain **why** only. No "what" comments.

### Design patterns specific to this SDK

- `Agent`, `Cron`, `Theokit` are **static-only façades** with `private constructor()`.
- Every error extends `TheokitAgentError` (except `UnsupportedRunOperationError` which now also does, per the post-review fix). Adding a new error class requires extending the hierarchy.
- Public types are `interface` (extensible) — concrete `class` is reserved for runtime/error/façade.
- Stream events are **discriminated unions** keyed on `type: "..."`.
- Static-only namespaces never have mutable state (no module-level `let`).
- Internal helpers go in `src/internal/`; they are not exported from `src/index.ts`.

---

## How the gates are wired

```
pnpm install
   └── postinstall (prepare script) → git config core.hooksPath .githooks

git commit
   └── .githooks/pre-commit (Tier 1 light: biome check + typecheck, ~5s)

git push
   └── .githooks/pre-push (Tier 1 full: pnpm validate, ~30-60s)

pnpm validate
   ├── pnpm check         (G2)
   ├── pnpm typecheck     (G1)
   ├── pnpm build         (sanity)
   ├── pnpm test          (G4)
   ├── pnpm validate:publint (G3)
   ├── pnpm validate:attw    (G3)
   └── pnpm quality
       ├── pnpm quality:dead         (G5 — knip)
       ├── pnpm quality:cycles       (G6, G7 — dep-cruiser)
       ├── pnpm quality:loc          (G8 — custom)
       └── pnpm quality:duplication  (G10 — jscpd)
```

`G9` (cognitive complexity) fires inside `pnpm check` because it is a Biome rule.

`G11` (docs.md sync) is in the PR checklist until automation lands.

---

## Adjusting a threshold

1. Open a PR that:
   - Edits this file (the contract) AND
   - Edits the tool config (e.g. `knip.json`, `.dependency-cruiser.cjs`, `biome.json`, `tools/check-loc.mjs`).
2. Adds a `CHANGELOG.md` entry (workspace-level) under `Changed`.
3. Includes a one-line rationale in the PR description: what broke, what we learned, why the new threshold serves the project.

Never adjust a threshold to make a single failing gate pass — that defeats the purpose. If the threshold is right and the code is wrong, the code changes.

---

## Open decisions

| # | Decision | Status |
| --- | --- | --- |
| Q1 | When to wire `tools/check-docs-sync.mjs` to automate G11. | **Pending** — Phase 2. |
| Q2 | Bundle size budgets (S2) once runtime adapters ship. | **Pending** — needs real `dist/`. |
| Q3 | Coverage threshold (S1) post-impl. Suggested 80% lines, 75% branches. | **Pending**. |
| Q4 | Should `.githooks/pre-commit` also run `quality:loc`? Currently NO (it's in pre-push). | **Pending** — adjust if commit cycle hits LoC overruns frequently. |
| Q5 | Conventional commits + `commitlint`. Out of Phase 1 scope; revisit if release automation needs structured changelogs. | **Pending** — Phase 2. |
