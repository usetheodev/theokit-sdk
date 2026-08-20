# Contributing to `@theokit/sdk`

Thanks for helping build the Theo **Harness**. The essentials are inline below; the exported TypeScript types are the canonical API contract. The code is the documentation.

By taking part you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md). Security problems do **not** go in an issue — see [SECURITY.md](./SECURITY.md).

## Quick start

```bash
nvm use                                   # Node 22.12+
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install
pnpm validate                             # build + typecheck + test + lint + quality gates
```

`pnpm validate` is what CI runs. If it is green locally it is usually green in CI — with one caveat worth knowing: turbo caches test results per package, and a change to a **root** file (`package.json`, the lockfile) does not invalidate that cache. After touching a root dependency, force a real run:

```bash
npx turbo run test --filter='./packages/*' --force
```

## Branch model

The flow is `workspace → develop → main`.

- **All work happens on `workspace`.** Features, fixes, refactors, docs, chores — everything commits there. We do **not** use feature branches by default.
- **`develop` integrates.** It only advances through a `workspace → develop` pull request.
- **`main` is release-only.** It receives release merges (`develop → main` PR + a semver tag) — never direct commits.
- `main` is protected by a ruleset: pull request required, force-push and deletion blocked, and the CI checks must pass before a merge.
- Never use `git checkout` (use `git switch` / `git restore`), `git revert` (write an explicit reversing commit), `git reset --hard` (use `git stash` / `--soft`), or `git push --force` on `main`/`develop`.

## Commit conventions

- Conventional-commit prefixes: `feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `style` / `ci` / `perf` / `build`.
- **No AI co-author trailers** (enforced by a git hook).
- Reference the issue or plan ID when there is one.
- Say *why*, not only *what*. A message that explains the reasoning is the only place that reasoning survives.

## Before you open a PR

- [ ] `pnpm validate` is green locally (or the specific package's `build` + `typecheck` + `test`).
- [ ] **TDD** — the failing test came first; a bug fix ships with its regression test.
- [ ] **Public API changed?** Update the exported types in the same PR — they are the contract.
- [ ] A **changeset** (`pnpm changeset`) if the change is user-visible. Changelogs are generated per package by Changesets under `packages/*/CHANGELOG.md`; there is no root changelog to edit.
- [ ] Lint + format clean (`pnpm check` — Biome).

## Test structure

Structure every test as **Arrange → Act → Assert**, separated by a blank line, no comment markers required:

```ts
it("enters plan mode", () => {
  const tool = createPlanModeTool();

  const result = JSON.parse(tool.handler({ action: "enter" }));

  expect(result.ok).toBe(true);
  expect(result.mode).toBe("plan");
});
```

That is the suite's de-facto style today — measured across all 817 test files, 2.2% carry explicit
`// Arrange` / `// Act` / `// Assert` comments or a `Given/When/Then` test name, but a sampled read
found the same three-part shape present and readable in unmarked files too, just without the labels.
This declares the convention `rules/testing.md` § 3 asks every repo to pick, without demanding a
rewrite: existing files named in `Given/When/Then` style stay as they are — converting them buys
nothing a reader doesn't already have, and the churn isn't worth it. Write new tests as AAA with a
blank line between each part; comment markers are optional and add little once the blank line does
the separating.

## What a wait must be

A test that waits — for a state, a frame, a file — must wait on a signal **the intermediate state
cannot satisfy**, taken from the source the code under test itself consumes.

A fixed sleep fails this: it is satisfied by the passage of time, which the code does not control. So
does a substring that was already present before the change. So does an independent probe of the same
state — that is a second opinion, not the same fact, and it moves the problem one level along.

**Read the message the wait produces when it fails.** If it names only the wait — "never reached X",
"timeout" — the instrument does not know what broke. If it names the value observed against the value
expected, it does:

```
task 1f3c… never reached error          <- reports the wait
task 1f3c… was "finished" — expected error   <- reports the defect
```

The second is the one to write. `tests/helpers/poll-until.ts` accepts a function for its message so it
can be built at failure time from the state the poll actually saw.

## A measurement that confirms you gets no second reading

Two instrument bugs on the same night, in two repositories:

- `git ls-remote --tags | tail` sorts **lexicographically**, so `v0.9.0` came back as the newest tag
  when 141 tags existed including `v0.72.0`.
- A coverage join matched repo-relative module paths against `SF:` entries that are
  **package-relative**, so an inverted `endsWith` matched nothing and reported *39 of 39 uncovered*.

Same class of bug. What differed is what happened next — and it was not care.

The first result **contradicted** its author's expectation and still went unchecked, because it
served the issue being written. The second **confirmed** the alarm it was measuring, which is the
position no checking instinct fires from. It was caught for one reason only: *39 of 39 is too clean
to be true.*

**The failure is not carelessness. It is confirmation.** A measurement that agrees with what you were
already going to write does not get a second reading, and that is precisely where the second reading
is cheapest.

The procedure that survives this is small, and it is the one that worked:

> **A number that is too round is a signal.** 39 of 39, zero findings, 100% — each earns the question
> *what would this result look like if the tool were broken?* If the answer is "the same", the
> measurement distinguishes nothing and you have learned only that the command ran.

## A claim about A does not transfer to B

`## Verify before you remove` covers the destructive direction — a premise that justifies deleting
something. There is a **lateral** direction it does not cover: a claim that is *true about the thing
you measured*, applied to a neighbour you did not.

Five real instances, collected across two repositories in one night:

| claim | said by someone who genuinely knew |
|---|---|
| "zero in-repo callers" | the repo — but grepped the wrong subdirectory |
| "the same loop held PR #34" | a CI they had watched |
| "four gates already cover this" | gates that do exist |
| "no mutation tooling exists" | a repo whose dependency had been added two days earlier |
| "your gate is shorter, so the same idle window applies" | a mechanism that had been **proved** — in a different repository |

**In none of the five was anyone guessing.** In every one, someone knew something true and extended
the confidence of that knowledge to an adjacent claim that had not been checked. The last is the
clearest precisely *because* the proof behind it was good: an isolated mechanism, a clean experiment,
three failures and one pass at the moment the variable changed. The extension inherited credit that
only the mechanism had earned. It was wrong — the neighbouring repository has no pre-push hook at all,
so the idle window it was said to have cannot exist there.

**The test takes five seconds and would have caught all five:**

> *Is this sentence about the system I just measured, or about a neighbour of it?*

If it is about the neighbour, **it inherits nothing** — not the confidence, and not the proof.

This is the symmetric inverse of a rule elsewhere in this file. There: *a hit for a reason nobody
chose is not a method.* Here: *a proof for a reason you did choose, applied where that reason does not
reach.*

## Fix the classification, never the requirement

When a gate blocks something it should not, there are two different situations and they take opposite
responses.

**The gate could not classify the case.** Then failing loudly is correct and you verify by hand. The
diff-scoped typecheck in `.githooks/pre-commit` selects zero packages for a documentation-only commit,
and refuses to pass silently — because "zero selected" is genuinely ambiguous: it is either a no-op
change or a stale ref hiding a real diff, and the gate cannot tell which. Teaching it about Markdown
would trade a five-second manual check for a new branch nobody tests.

**The gate classified the case wrongly, with confidence.** Then fix the classification. A sibling
repository had a CHANGELOG gate that called a test fixture production source — not ambiguity, a
pattern that did not know the layout, in the one place that did not know it while `knip.json` and the
testing conventions both already treated `tests/**` as non-production.

The difference matters because the second kind is expensive in a way the first is not. A gate
demanding a public changelog entry for a test-only change invites either a **fabricated entry** —
which pollutes the contract consumers read — or reaching for an override. **Reaching for an override
to satisfy a wrong classification is how a gate stops being taken seriously**, and it does not stop
at that gate.

When you do fix a classification, check both directions. The failure mode is over-exclusion, which
retires the gate silently: confirm the things that *should* still be caught still are.

## While a mutant is applied, the tree is not yours

Mutation testing means editing production source, running something, and restoring it. During that
window the working tree does not say what the repository says — and the rule is **not** "do not
commit". It is stronger:

**No other process may compile, test, lint or inspect the tree while a mutant is applied — reading is
as unsafe as writing.** A concurrent reader corrupts nothing. It *harvests your mutant as a finding*,
and the result has the same shape as a real defect.

Two real incidents, and the second is the dangerous one:

- An agent ran `git add -A` while a mutation run was rewriting `src/**` in place. The result was a
  **1268-file patch** — obvious, caught immediately, harmless.
- A sibling repository ran a five-pass suite loop while a single-line mutant was applied for a few
  seconds. Two of the passes came back `1 failed | 1688 passed` — **exactly the signature of the
  intermittent write race that loop was measuring.** Plausible, and plausible is worse. Without
  knowing when the mutant was applied, those two lines would have confirmed a flakiness claim using
  noise from the measuring instrument itself.

There is a third form, and it is the one that ships a lie. Closing the window with
`git restore <file>` **discards the fix along with the mutant** when both live in the same uncommitted
file. The gates then run green against a tree with no fix in it. In the observed case the only thing
that caught it was `git commit` answering *"nothing to commit"* — a different commit message, or a
`git add` first, and an empty commit would have shipped declaring the bug fixed.

| # | shape | what it produces |
|---|---|---|
| 1 | a snapshot inside the window captures the mutant | a 1268-file patch |
| 2 | a concurrent **reader** harvests the mutant | two runs of `1 failed \| 1688 passed` |
| 3 | the restore that closes the window discards the **fix** | green gates over no fix at all |

Form 3 is worth breaking down further, because the three ways of closing a window differ in whether
anything warns you at all:

| closing the window with | what warns you |
|---|---|
| `git restore <file>` | nothing fails; a later `git commit` says *"nothing to commit"* — a weak signal, and only if you commit before staging |
| `git checkout-index -f -- <file>` | **nothing warns you at all.** The file returns to HEAD and the suite passes, correctly, over unfixed code |
| `cp -f /tmp/bak <file>` | cannot lose the fix — but only if the backup was taken *after* it |

Both of the first two happened here on the same day. Neither had a guard; one of them happened to
produce a side effect. **"Restore carefully" is not a rule, because there is no careful enough
restore** — the only thing that closes the whole class is the ordering: commit the fix before you
measure it.

**One rule covers all three, and it is simpler than any of them: commit the fix BEFORE you measure
it.** Then the window contains exactly one uncommitted thing — the mutant — and `git restore` can
only undo that. There is a second, independent reason: a mutant measured against uncommitted code is
measuring something that does not yet exist anywhere.

So: **declare the window, do not merely observe it.** Write down "mutant applied 02:11, restored
02:13" *before* applying, so contamination is attributable immediately rather than reconstructed
later. Discipline only helps while you remember you are inside a window, and the person who wrote
this rule violated it within the hour, having written it.

**And when judging whether a past result survives a contaminant, ask what it REMOVES as well as what
it adds.** A mutant only adds failures, so a "zero failures" claim is robust to one. A mis-scoped
restore removes a fix, so the same claim is *fragile* to that — it pushes the number green. The two
contaminants push opposite ways and only one of them is intuitive.

Prefer a worktree for anything that mutates. A worktree has its own `src/`, so nothing else on the
machine can read through your window.

## Verify before you remove

A premise that only justifies **keeping** something can be wrong and survive. One that justifies a
**deletion** cannot. So the rule is not "check your claims" — it is: *check the claim that is about to
delete something.*

This is checkable while you read, which is what makes it usable. "Is this claim too strong?" is only
answerable after you have already checked it.

Three removals in this repository were argued from a premise that turned out to be false. Two were
caught; one was not:

| Claim | Reality |
|---|---|
| "`plugins.paths` is undeclarable, so the guard is unreachable" | A contract test supplies it by cast. The guard was deleted and the pre-push gate caught the regression. |
| "the barrel test duplicates four build gates" | None of the four reaches that package. Deleting it would have removed the only coverage of that surface. |
| "this helper has zero in-repo callers" | It had four. |

The mechanism behind all three is worth stating, because it explains why review does not catch them:
**a claim stronger than the argument needs passes unaudited precisely because it is doing no work.**
Nobody re-derives a premise the conclusion does not rest on. "Zero callers" and "four gates already
cover this" both sound settled, and neither was load-bearing until someone reached for the delete key.

One corollary, since it is the most common case here: **the type system is not a runtime.** "The type
forbids it" says a TypeScript caller cannot express the value. A JavaScript caller, a JSON config, or
an `as` cast can. A reachability argument is admissible for an internal call shape and inadmissible
for a boundary check — boundary checks exist for the callers you have not met.

And its silent sibling: **`as` is "the type already guarantees it" without even the argument.** It is
not a reachability claim you can weigh — it is an assertion of reachability with the reasoning
removed. The guard that was deleted here on "the types forbid it" was refuted by a contract test that
supplied the value *by cast*.

## Quality gates

The push is gated locally by `.githooks/pre-push`, and again in CI. Every gate is one tool, and the rule is **fix the code, not the threshold**:

| Gate | Command | What it refuses |
| --- | --- | --- |
| Lint / format | `pnpm check` | Biome findings |
| Types | `pnpm typecheck` | any type error |
| Tests | `pnpm test` | a failing or newly skipped test |
| Dead code | `pnpm quality:dead` + `quality:dead-internal` | unreachable exports, dead private symbols |
| Cycles | `pnpm quality:cycles` | any import cycle (threshold 0) |
| Layering | `pnpm quality:depcruise` | a dependency pointing the wrong way |
| Cluster boundary | `pnpm quality:cross-cluster` | importing an extracted sibling repo |
| File size | `pnpm quality:loc` | a source file over 400 LoC |
| Duplication | `pnpm quality:duplication` | a copied block in `packages/sdk/src` |
| Docs drift | `pnpm quality:capability-map` | a documented import that no longer resolves |
| Dependencies | `pnpm quality:audit` | a known vulnerability in a shipped dependency |
| Bundle size | `pnpm check:bundle` | a package over its `.bundle-budget.json` |

CI adds a Node `22.12` / `22` matrix, CodeQL, dependency review on pull requests, and an OpenSSF Scorecard run.

## Where things live

`theokit-sdk` is a pnpm-workspaces + turbo monorepo of 12 publishable packages (flagship `@theokit/sdk` at `packages/sdk/`). Layout and the contract-vs-implementation split: [`packages/README.md`](./packages/README.md).

## Getting help

Open an issue — the [templates](https://github.com/usetheokit/theokit-sdk/issues/new/choose) ask for the details that make a report actionable. A heads-up before a large change is welcome and usually saves you a rewrite.
