---
name: quality-review
description: Review a TypeScript change against the `@usetheo/sdk` quality gates — SOLID, DRY, Clean Code, design patterns, and contract sync. Use after major feature work, before opening a PR, or when asked for a "quality review", "SOLID check", "PR review", or "review for clean code". Pairs with the hard gates documented in `.claude/quality-gates.md`.
---

# Quality Review

Run this skill **before** opening a PR or after substantial source changes. It complements the automated Tier 1 gates with the manual judgment that Tier 3 requires.

The full contract is in [`.claude/quality-gates.md`](../quality-gates.md). The user-facing summary is in [`docs/development/quality-gates.md`](../../docs/development/quality-gates.md).

## When to use

- After implementing a feature → before commit.
- After editing public-surface files (`src/index.ts`, `src/agent.ts`, `src/cron.ts`, `src/theokit.ts`, `src/errors.ts`, `src/types/*`).
- When the user asks for "quality review", "SOLID check", "DRY check", "clean code review", or "review the PR".
- Before declaring a feature done.

## Steps

### 1. Snapshot the change

Run `git diff --stat origin/main...HEAD` (or against the target branch). List the touched files.

### 2. Pre-flight automated check

Confirm the hard gates pass on the current branch:

```bash
pnpm -w run validate
```

If any hard gate fails, **stop**. Fix automated issues first; manual review is wasted on broken automated quality.

### 3. For each changed `.ts` file under `packages/sdk/src/`, walk this checklist

#### SOLID

- [ ] **SRP** — Does this module have **one** reason to change? Read its name: if you'd write "X **and** Y" to describe it, it does too much.
- [ ] **OCP** — Are new behaviors added (new file / new strategy / new entry in a discriminated union) or did we edit a growing switch/case?
- [ ] **LSP** — If this is a subclass, does it strengthen preconditions or weaken postconditions? It shouldn't.
- [ ] **ISP** — Does any interface have > 7 methods? Justify each one or split.
- [ ] **DIP** — Is `fetch`, `fs`, `path`, `process` used directly in domain code, or through an interface from `src/internal/` or `src/runtime/`?

#### DRY

- [ ] Is a business rule implemented in 3+ places? Extract to a shared helper.
- [ ] Are validation patterns repeated? Consider a schema (Zod) or factored helper.
- [ ] Did jscpd flag any duplication in `pnpm quality:duplication`?

#### Clean Code

- [ ] Functions ≤ 50 LoC?
- [ ] Function parameters ≤ 4? (5+ → consider a parameter object.)
- [ ] Boolean parameters ≤ 2? Flag args (`fn(x, true)`) → split into two functions.
- [ ] Nested levels ≤ 3? Use early returns, extract functions.
- [ ] Names intention-revealing? No `data`, `tmp`, `helper`, `mgr`, `util` without specifics.
- [ ] Comments explain **why** not **what**? "Increment counter" is bad; "Fixes off-by-one when stream closes mid-tool-call" is good.
- [ ] No commented-out code blocks.

#### Project-specific design patterns

- [ ] If adding a new top-level façade: is it `class X { private constructor(); static method() {} }`?
- [ ] If adding a new error: does it `extends TheokitAgentError`? Does it set `isRetryable` deliberately?
- [ ] If adding a public type: is it `interface` (extensible) — not a `class`?
- [ ] If adding a new stream event: does it use `type: "name"` discrimination?
- [ ] Are exports in `src/index.ts` sorted by source file (Biome enforces, but check)?
- [ ] `verbatimModuleSyntax`: type-only imports use `import type`?

#### Contract sync

- [ ] Was `src/types/*` or any public-surface file touched? If yes, was `docs.md` updated in the same diff?
- [ ] Was a new public symbol added? Is it documented in `docs.md` AND in a relevant `docs/guides/*` page?
- [ ] Did the change rename, remove, or alter behavior of a public symbol? Is `CHANGELOG.md` updated under `Changed` / `Removed` / `Deprecated`?

### 4. Cross-cutting checks

- [ ] All files ≤ 400 LoC (run `pnpm quality:loc`).
- [ ] No new circular dependencies (`pnpm quality:cycles`).
- [ ] No new dead code (`pnpm quality:dead`).
- [ ] No new high-duplication blocks (`pnpm quality:duplication`).

### 5. Output

Produce a structured report:

```markdown
# Quality Review — <branch or commit>

## Automated gates
- typecheck: PASS / FAIL
- biome check: PASS / FAIL
- tests: PASS (n/m) / FAIL
- publint: PASS / FAIL
- attw: PASS / FAIL
- knip: PASS / FAIL
- depcruise: PASS / FAIL
- loc: PASS / FAIL (worst: <file>:<count>)
- jscpd: PASS / FAIL (<dup%>)

## SOLID
- SRP: <findings>
- OCP: <findings>
- LSP: <findings>
- ISP: <findings>
- DIP: <findings>

## DRY
- <findings>

## Clean Code
- <findings>

## Project patterns
- <findings>

## Contract sync
- <findings>

## Verdict
- [ ] APPROVE — ready to merge
- [ ] APPROVE WITH NITS — list nits, none blocking
- [ ] CHANGES REQUESTED — list blockers
```

Order findings by severity: **Critical** (blocks contract or stability) → **Major** (SOLID / DRY violation) → **Minor** (Clean Code) → **Style** (preference).

Always include a one-line **suggested fix** with each finding. "This function is too long" without a fix is useless; "Extract `parseHeaders()` to reduce `handleResponse` from 87 to ~40 LoC" is actionable.

## Inviolable principles

- **Never approve a PR that breaks an automated hard gate.**
- **Never recommend lowering a threshold to silence a failure.** If the threshold is right and the code is wrong, the code changes. Threshold changes require their own PR with rationale (see `.claude/quality-gates.md` "Adjusting a threshold").
- **Never invent rules not in the contract.** If you spot something worth enforcing that isn't in `.claude/quality-gates.md`, flag it as a "proposed gate" in the report — do not block on it.
- **Cite the contract.** When flagging a violation, cite the gate (`G5`, `G8`, etc.) so the author can trace it.
