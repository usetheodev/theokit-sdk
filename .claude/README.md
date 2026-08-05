<div align="center">

# Cycle

**Ship features with evidence, not assumptions.**

[![Status](https://img.shields.io/badge/status-beta-orange)](CHANGELOG.md)
[![Version](https://img.shields.io/badge/version-1.0.0-blue)](plugin.json)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-632%20passing-brightgreen)](.github/workflows/test.yml)
[![Python](https://img.shields.io/badge/python-3.10%2B-3776AB)](pyproject.toml)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-blueviolet)](https://code.claude.com/docs/en/)

A stack-agnostic **6+1 cycle pipeline** that carries a feature from **idea → discovery → plan → code → merge**, with Claude Code as the active agent at every step. Hard gates, audit trails, and runtime hooks keep plans from being vague and stop code from shipping on assumptions.

[Quick start](#quick-start) · [Flows](#three-common-flows) · [How it works](#the-61-cycles-macro-super-loop) · [Project structure](#project-structure) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

<img src="images/cycle-hero.png" alt="Cycle — the 6+1 cycle pipeline: Roadmap-init → Discover → Plan → Implement → Code-Quality → Review → Release as a macro super-loop, with hard gates, audit trails, and runtime hooks, and Claude Code as the active agent at every step" width="100%">

</div>

---

## Table of contents

- [Why this exists](#why-this-exists)
- [Highlights](#highlights)
- [The 6+1 cycles](#the-61-cycles-macro-super-loop)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Three common flows](#three-common-flows)
- [Flows for maximum value](#flows-for-maximum-value)
- [Project structure](#project-structure)
- [Unbreakable principles](#unbreakable-principles)
- [Match the cycle to the work](#match-the-cycle-to-the-shape-of-the-work)
- [Orthogonal LLM jury](#orthogonal-llm-jury-optional-but-recommended)
- [Two ways to use this](#two-ways-to-use-this)
- [Contributing](#contributing)
- [License](#license)

---

## Why this exists

Three failure modes show up repeatedly when LLMs help build software:

1. **Plans written before requirements are clear** — vague goal, missing constraints, no measurable success criterion.
2. **Code shipped on assumptions** — symbols that don't exist, callers that were never wired, metrics declared but never observed.
3. **Reviews that miss systemic issues** — single reviewer, single pass, biased toward the implementer's mental model.

This project fixes each one with a dedicated cycle, an unbreakable chain between them, and runtime hooks that block the most common shortcuts (force-push, direct-to-main, dead-code commit, plan tampering).

## Highlights

- **Idea-to-merge in one chain.** Seven composable cycles (Roadmap → Discover → Plan → Implement → Code-Quality → Review → Release) that you enter at the lightest point matching your task.
- **Evidence over assumptions.** A plan ships only at verdict `SHIPPABLE_WITH_CAVEATS` or better; code advances only when fabricated symbols, dead code, and unwired call-sites are absent.
- **Guardrails at runtime, not in a wiki.** 8 Claude Code hooks enforce git safety (no `--force`, no direct-to-`main`), TDD discipline, CHANGELOG hygiene, and honest public copy as you work.
- **Multi-agent review.** `/review` runs 5–7 specialist sub-agents in parallel; an optional [GPT-Codex jury](#orthogonal-llm-jury-optional-but-recommended) adds an orthogonal second opinion to break single-model blind spots.
- **Stack- and domain-agnostic.** Python, TypeScript, Go, and Rust gates ship in-box; thresholds calibrate to your codebase. Nothing here assumes a particular framework.
- **Auditable by design.** Every cycle writes a dated artifact under `knowledge-base/`, so decisions, evidence, and verdicts are traceable after the fact.
- **Dual delivery.** Use it standalone (open the repo in Claude Code) or install it as a plugin — same source, two modes.

## The 6+1 cycles (macro super-loop)

```
            ┌──────────────────────────────────────────┐
            │       ROADMAP-INIT  (once, at start)     │
            │  /roadmap-init — Socratic grill + SOTA   │
            │  → ROADMAP.md (M0..M8 macro milestones)  │
            │  → knowledge-base/references/ (peers)    │
            └──────────────────┬───────────────────────┘
                               │ ROADMAP.md exists
                               ▼
            ┌──────────────────────────────────────────┐ ◄────────────┐
            │       ROADMAP  (macro super-loop)        │              │
            │  select next [ ] milestone respecting    │              │
            │  dependencies → delegate /auto-plan M<N> │              │
            └──────────────────┬───────────────────────┘              │
                               │ milestone_id derived                 │
                               ▼                                      │
              ┌─────────────────────┐                                 │
              │   DISCOVER (opt.)   │                                 │
              │   prior art study   │                                 │
              └──────────┬──────────┘                                 │
                         │ blueprint                                  │
                         ▼                                            │
            ┌──────────────────────────────────────────┐              │
            │                  PLAN                    │              │
            │  Phase 0 (opt.): /grill-me — interview   │              │
            │  /to-plan → /edge-case-plan →            │              │
            │  /deps-audit → /plan-confidence          │              │
            │  plan frontmatter: milestone_id: M<N>    │              │
            └──────────────────┬───────────────────────┘              │
                               │ verdict ≥ SHIPPABLE_WITH_CAVEATS     │
                               ▼                                      │
            ┌──────────────────────────────────────────┐              │
            │              IMPLEMENT                   │              │
            │  halt-loop: RED → GREEN → REFACTOR →     │              │
            │  WIRING(triad) → COMMIT                  │              │
            └──────────────────┬───────────────────────┘              │
                               │ IMPLEMENTATION_COMPLETE              │
                               ▼                                      │
            ┌──────────────────────────────────────────┐              │
            │            CODE-QUALITY                  │              │
            │  dead code + fabricated symbols          │              │
            │  + wiring gaps                           │              │
            └──────────────────┬───────────────────────┘              │
                               │ PASS or PASS_WITH_CAVEATS            │
                               ▼                                      │
            ┌──────────────────────────────────────────┐              │
            │                REVIEW                    │              │
            │  5-7 specialist agents in parallel       │              │
            │  → verdict: READY_TO_MERGE / NEEDS_FIXES │              │
            └──────────────────┬───────────────────────┘              │
                               │ READY_TO_MERGE                       │
                               ▼                                      │
            ┌──────────────────────────────────────────┐              │
            │               RELEASE                    │              │
            │  auto-bump semver, rewrite CHANGELOG,    │              │
            │  open develop→main PR + tag on merge     │              │
            │  post-merge: ROADMAP.md M<N> [ ]→[x]     │──────────────┘
            │  → verdict: MILESTONE_RELEASED           │   loop back to ROADMAP
            └──────────────────────────────────────────┘   until ROADMAP_COMPLETE

  Shortcut per milestone:  /auto-plan M<N>   (or /auto-plan with no arg → picks next)
  Shortcut ad-hoc:         /auto-plan {topic-slug}   (no roadmap link, hotfix mode)
```

Each arrow is an **unbreakable chain** — you don't skip a cycle, you don't advance past an INVALID verdict, and the hooks enforce git safety (no `checkout`, no `--force`, no `main` commits) at every step. The macro loop closes only when every milestone in `ROADMAP.md` is `[x]` (verdict `ROADMAP_COMPLETE`).

## Requirements

| Dependency | Version | Required for |
|---|---|---|
| [Claude Code](https://code.claude.com/docs/en/) | latest | everything (CLI, desktop, or IDE) |
| Python | 3.10+ | skill scripts, validators, quality gates |
| PyYAML | 6.0+ | frontmatter + rubric parsing |
| [`ralph-loop`](https://github.com/) plugin | latest | `/implement`, `/discover-execute`, `/plan-improve` halt-loops |
| `ast-grep` | latest | structural code queries (optional but recommended) |
| `hypothesis` | latest | property-based tests (dev/CI only) |

Tested on Linux and macOS with Python 3.10, 3.11, and 3.12.

## Quick start

### Setup (once per environment)

1. Install Claude Code (CLI / desktop / IDE — any).
2. Install the `ralph-loop` plugin (required by `/implement`, `/discover-execute`, `/plan-improve`).
3. Open this directory in Claude Code. The `settings.json` wires hooks; `skills/` and `commands/` are auto-discovered.
4. Verify pre-conditions:
   ```bash
   python3 --version              # 3.10+ required
   python3 -c "import yaml"       # PyYAML
   ast-grep --version             # structural queries
   jq '.enabledPlugins' ~/.claude/settings.json | grep ralph-loop
   ```
5. Edit `rules/dogfood-golden-rule.md` § 1 (anchor scenario), `rules/code-quality-languages.txt`, and `rules/discover-web-allowlist.txt` for your project.

### Three common flows

**A. I have a clear feature to build** (most common path)
```
/to-plan "{one-sentence feature}"
/edge-case-plan {slug}
/deps-audit {slug}
/plan-confidence {slug}
# if verdict ≥ SHIPPABLE_WITH_CAVEATS:
/implement {slug}
/code-quality {slug}
/review {slug}
# verdict READY_TO_MERGE:
/release            # opens PR develop→main + proposes semver tag (human approves merge)
```

**B. The feature is vague and needs requirements grilling first**
```
/grill-me {topic-slug}
# interview-driven, one Q at a time, codebase-first
# produces knowledge-base/grills/{slug}-grill.md
# then continue with flow A
```

**C. I don't know how others solved this — need prior art first**
```
/discover-plan {topic-slug}
/discover-edge-cases {slug}
/discover-plan-confidence {slug}
/discover-execute {slug}
/discover-confidence {slug}
# verdict ≥ SHIPPABLE_WITH_CAVEATS → blueprint in knowledge-base/discoveries/blueprints/
# optionally distil into a first-class skill via the standalone /skill-creator
# then go to flow A — /to-plan reads the blueprint as input
```

**Shortcut for autonomous end-to-end:** `/auto-plan {topic-slug}` chains everything. Use when the topic is large enough to justify autonomous execution.

## Flows for maximum value

The pipeline is most effective when the **right cycle is invoked for the right shape of work**. Map your task to the closest scenario:

### Scenario 1 — Vague request, no prior art known

> "We need user authentication that doesn't lock us into one vendor."

```
/grill-me user-auth
  → resolves: identity source? session storage? RBAC vs ABAC? recovery flow?
  → verdict: NEEDS_DISCOVERY (prior art on identity adapters unknown)
/discover-plan user-auth-adapter-patterns
  → investigates 2-3 reference projects' approaches
/discover-execute / discover-confidence
  → blueprint with side-by-side comparison + ADRs
/to-plan user-auth
  → cites grill decisions + blueprint
/edge-case-plan → /deps-audit → /plan-confidence
/implement → /code-quality → /review
```

### Scenario 2 — Clear spec already exists

> "Spec doc at docs/specs/payment-retry.md describes exactly what to build."

```
/to-plan payment-retry            # skip grill-me; spec is the input
/edge-case-plan → /deps-audit → /plan-confidence
/implement → /code-quality → /review
```

### Scenario 3 — Trivial bug fix

> "Off-by-one in pagination."

```
# No cycle needed. Write failing test, fix, commit, PR.
# Use the cycle pipeline only when the change has > 3 decision branches OR touches > 1 module non-trivially.
```

### Scenario 4 — Cross-cutting refactor

> "Migrate from synchronous to async I/O across 12 modules."

```
/grill-me async-migration         # constraints: backward compat? rollout strategy?
/discover-plan async-migration-prior-art    # how do other projects stage this?
# ... full chain
# Likely NEEDS_SPLIT verdict on grill — break into per-module slices.
```

### Scenario 5 — Pre-release v1.0 claim

> "Are we ready to drop the 'beta' label?"

```
/dogfood audit
# Reads knowledge-base/dogfood/manifest.md + evidence/
# Applies rules/dogfood-golden-rule.md
# Emits EVIDENCE_SUFFICIENT / EVIDENCE_WITH_CAVEATS / EVIDENCE_INSUFFICIENT
# If INSUFFICIENT, /public-copy-lint will catch attempts to claim production-ready in README
```

### Scenario 6 — Periodic maintenance

```
/loop 7d /code-quality            # weekly dead-code / fabricated-symbol sweep
/loop 7d /deps-audit              # weekly CVE check
```

## Project structure

```
.
├── README.md                      ← you are here
├── HOW-TO-USE.md                  ← detailed onboarding for new contributors
├── ROADMAP.md                     ← macro milestones (M0..M8) — written by /roadmap-init, edited by cycle-release
├── plugin.json                    ← manifest for marketplace install
├── settings.json                  ← Claude Code permissions + hooks wiring
├── settings.local.json            ← personal overrides (gitignored)
├── .active_plan.example           ← pin a specific plan as active
│
├── skills/                        ← 28 skills (cycle entry-points + utilities)
│   ├── roadmap-init/              ← single-shot at project inception (Socratic + SOTA clone)
│   ├── roadmap-feature/           ← add one new milestone to an existing roadmap (sister of roadmap-init)
│   ├── grill-me/                  ← Phase 0 of cycle-plan (interview)
│   ├── to-plan/                   ← cycle-plan main entry
│   ├── discover-plan/             ← cycle-discover main entry
│   ├── implement/                 ← cycle-implement halt-loop
│   ├── code-quality/              ← cycle-code-quality audit
│   ├── review/                    ← cycle-review parallel agents
│   ├── release/                   ← cycle-release: develop→main PR + semver tag + ROADMAP.md checkbox flip
│   ├── auto-plan/                 ← cycle-auto-plan orchestrator (sub-cycle of cycle-roadmap)
│   ├── dogfood/                   ← honesty gate for v1.0 claims
│   ├── deck/, marp-slide/,        ← utility skills (slides/diagrams)
│   │   excalidraw/, ast-grep/
│   └── skill-creator/             ← author/improve/eval any skill (standalone)
│
├── rules/                         ← Source of Truth for cycles + conventions
│   ├── architecture.md            ← layering, DIP boundaries
│   ├── testing.md                 ← TDD discipline, pyramid
│   ├── public-copy.md             ← banned framings in README/marketing
│   ├── cycle-roadmap.md           ← macro super-loop: roadmap → … → release → roadmap (loop)
│   ├── cycle-discover.md          ← discovery cycle contract
│   ├── cycle-plan.md              ← planning cycle contract
│   ├── cycle-implement.md         ← implementation cycle contract
│   ├── cycle-code-quality.md      ← code-quality cycle contract
│   ├── cycle-review.md            ← review cycle contract
│   ├── cycle-release.md           ← release cycle contract (develop→main + tag + roadmap flip)
│   ├── cycle-auto-plan.md         ← auto-orchestrator contract (one milestone per run)
│   ├── code-quality-golden-rule.md  ← locked code-quality severity rubric
│   ├── code-quality-thresholds.txt  ← per-project threshold overrides
│   ├── code-quality-allowlist.txt   ← findings exemptions (mandatory sunset)
│   ├── discover-blueprint-golden-rule.md ← locked discover-confidence hard caps
│   ├── dogfood-golden-rule.md     ← anchor scenario + status vocab
│   ├── audit-trail-rotation.md    ← when to archive/delete artifacts
│   ├── loop-engine-convention.md  ← Skill vs. Agent vs. ralph-loop
│   ├── discover-web-allowlist.txt ← authoritative domains for WebFetch
│   └── code-quality-languages.txt ← enabled languages per project
│
├── hooks/                         ← 8 defensive runtime hooks
│   ├── sessionstart-context.sh    ← injects git/plan/loop status at session start
│   ├── userpromptsubmit-inject.sh ← injects active plan excerpt before each prompt
│   ├── validate-command.sh        ← blocks git destructive ops + Co-Authored-By trailers
│   ├── boundary-check.sh          ← read-only enforcement on references/ + tools/
│   ├── post-edit-check.sh         ← multi-language linter feedback
│   ├── public-copy-lint.sh        ← banned framings in README/marketing
│   ├── stop-validation.sh         ← TDD gate + CHANGELOG check
│   └── precompact-preserve.sh     ← snapshots before context compaction
│
├── commands/                      ← 3 parallel utilities
│   ├── plan-attest.md             ← SHA256 attest plan against tampering
│   ├── plan-goal.md               ← bridge active plan to Claude Code /goal
│   └── plan-loop.md               ← bridge active plan to Claude Code /loop
│
├── knowledge-base/                ← all generated artifacts live here
│   ├── grills/                    ← /grill-me Q&A logs
│   ├── plans/                     ← /to-plan outputs
│   ├── discoveries/
│   │   ├── plans/                 ← /discover-plan outputs
│   │   ├── blueprints/            ← /discover-execute outputs
│   │   └── snapshots/             ← WebFetch snapshots (hash-verified) cited by blueprints
│   ├── implementations/           ← /implement halt-loop logs + summaries
│   ├── reviews/                   ← /plan-confidence, /discover-confidence, /review reports
│   ├── releases/                  ← /release run records (per version)
│   ├── roadmap-runs/              ← cycle-roadmap per-milestone audit trail (in_progress/completed/blocked)
│   ├── adrs/                      ← long-term ADRs (MADR 3.0)
│   ├── audits/                    ← /deps-audit, /code-quality reports
│   ├── dogfood/                   ← anchor manifest + evidence files
│   ├── backlog.md                 ← deferred/not-yet-implemented items
│   ├── references/                ← read-only clones of reference projects (seeded by /roadmap-init)
│   └── tools/                     ← read-only docs of tools the project depends on
│
├── scripts/                       ← shared utilities
│   ├── ecosystem_utils.py         ← shared layout detection (DRY module)
│   ├── validate_skill_frontmatter.py ← CI skill contract validator
│   ├── generate-plugin-settings.py ← generates settings.plugin.json from settings.json
│   ├── attest-plan.sh             ← used by /plan-attest
│   ├── statusline.sh              ← Claude Code status line
│   ├── check_xrefs.py             ← validate cross-references (dual-mode)
│   ├── session-catchup.py         ← rebuild context post-compaction
│   ├── run_slice_tests.sh         ← run every skills/*/tests suite isolated (CI + local)
│   └── test_e2e_smoke.py          ← CI smoke test (syntax + xrefs + smoke chain)
│
├── tests/                         ← root suite (17) + 45 hook integration tests
│   ├── test_ecosystem_utils.py    ← 11 layout detection tests
│   ├── test_skill_frontmatter.py  ← 6 skill contract tests
│   └── hooks/                     ← 45 hook integration tests (bash)
│       ├── test_validate_command.sh
│       ├── test_boundary_check.sh
│       └── test_stop_validation.sh
│   # 615 more tests live in skills/*/tests — each slice runs isolated in CI
│   # via scripts/run_slice_tests.sh (632 Python tests total)
│
└── agents/                        ← audit trail of cycle runs
```

## Unbreakable principles

These apply in every cycle and are enforced by hooks where automatable:

1. **95% confidence rule** — never proceed without 95%+ certainty. Ask when unsure. `/grill-me` operationalizes this for vague plans.
2. **Task completion gate** — finish the current task before starting a new one.
3. **Extreme honesty** — admit ignorance; expose risks; never invent state. `/dogfood` blocks v1.0 claims without measured evidence.
4. **Git rules** — NEVER `git checkout`, `git revert`, `git push --force`, `git reset --hard`, or commit to `main`. Enforced by `hooks/validate-command.sh`.
5. **TDD-first** — failing test before code; bug fix starts with a regression test. Warned by `hooks/stop-validation.sh`.
6. **CHANGELOG discipline** — every change in `[Unreleased]`. Warned by `hooks/stop-validation.sh`.
7. **Don't reinvent** — mature libraries exist; prefer composition over rewriting. `/deps-audit` checks Rule 9 evaluation on new deps.

## Match the cycle to the shape of the work

Each cycle is heavyweight by design — they trade speed for evidence. Pick the lightest entry point that fits the work:

| Cycle | Best for | When NOT to use |
|---|---|---|
| `cycle-discover` (full chain) | Unknown prior art; investigating how others solved the problem | Question is text-shape (use Read + Grep) |
| `cycle-plan` (full chain, no grill) | Clear feature with known shape | Trivial change (single-line) |
| `cycle-plan` (with `/grill-me`) | Vague requirements, multi-branch decision tree | Spec already detailed |
| `cycle-implement` (halt-loop) | Building per an approved plan | No plan (run cycle-plan first) |
| `cycle-code-quality` | Post-implement audit | Uncommitted tree |
| `cycle-review` (5-7 agents) | Pre-merge rigorous review | Tiny PR (built-in `/review` is enough) |
| `cycle-judge-codex` (optional external plugin) | Orthogonal LLM jury alongside `/review` — breaks the Claude-only monoculture by adding GPT-Codex as a second jury family | Sessions where Codex CLI is not installed; trivial single-line changes |
| `cycle-release` | Cutting a versioned release after `/review` returns `READY_TO_MERGE` | Nothing in `[Unreleased]` to ship |
| `/auto-plan` (super-cycle) | Large, well-scoped topics warranting autonomy | Plan already exists (call `/implement` directly) |

The cheapest cycle is the one you don't run.

## Claude Code best practices conformance

This ecosystem follows [Claude Code](https://code.claude.com/docs/en/) conventions:

- **Skill frontmatter**: `name`, `description`, `user-invocable`, `allowed-tools`, `argument-hint`, `paths` (where applicable) per [Skills spec](https://code.claude.com/docs/en/skills).
- **Hook JSON output**: canonical `hookSpecificOutput.additionalContext` format per [Hooks reference](https://code.claude.com/docs/en/hooks).
- **Permissions**: granular allow/ask/deny lists with `defaultMode` declared.
- **Plugin manifest**: `plugin.json` allows installation via marketplace.
- **Composition**: orchestrator skills (`to-plan`, `implement`, `review`, `auto-plan`) declare `Skill` and `Agent` in `allowed-tools` for sub-skill / sub-agent invocation.

See `HOW-TO-USE.md § Maintenance notes` for details.

## Orthogonal LLM jury (optional but recommended)

`cycle-review` runs 5–7 Claude sub-agents in parallel — but they share the same model family's blind spots. The **`judge-codex` plugin** ([usetheodev/judge-codex-plugin-cc](https://github.com/usetheodev/judge-codex-plugin-cc)) adds **GPT-Codex** as an orthogonal jury that re-validates each cycle artifact against the same canonical golden rules used here. When Claude and Codex **agree**, confidence ↑. When they **disagree**, the pipeline halts for human adjudication.

```bash
# install once per environment
npm install -g @openai/codex
codex login

/plugin marketplace add usetheodev/judge-codex-plugin-cc
/plugin install judge-codex@judge-codex
/judge-codex:setup

# use after any plan cycle stage
/judge-codex:plan {slug}            # judge a /to-plan output
/judge-codex:auto {slug}            # end-to-end across all 4 stages
```

Contract documented in `rules/cycle-judge-codex.md`. Verified live: caught a fabricated ADR citation that `plan-confidence` M3 v0.1 had missed (different scope: structural Evidence-block scan vs full plan prose).

## Two ways to use this

**Standalone** — open this directory in Claude Code. Everything works as-is: hooks fire, skills are discovered, commands are invokable.

**Plugin install** — when published to a marketplace, Claude Code reads `plugin.json` and wires the same components under the plugin namespace. Same source, two delivery modes.

## Next steps

- New contributor: read [`HOW-TO-USE.md`](HOW-TO-USE.md) — the detailed operational guide.
- Designing a feature: start with `/grill-me {topic}` or `/to-plan "{description}"`.
- Investigating prior art: `/discover-plan {topic}`.
- Cycle deep dive: `rules/cycle-{name}.md`.
- Specific skill: `skills/{name}/SKILL.md`.

## Contributing

Contributions are welcome. This project is built with its own cycle, so the workflow doubles as the contribution guide:

1. Work on the `develop` branch (never `main` — it receives release merges only).
2. For non-trivial changes, run the matching cycle (`/to-plan` → `/implement` → `/code-quality` → `/review`).
3. Add a failing test before the fix (TDD), keep the suite green (`bash scripts/run_slice_tests.sh`), and record every change under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full checklist and [`HOW-TO-USE.md`](HOW-TO-USE.md) for the operational guide.

## Security

Found a vulnerability? Please follow the disclosure process in [`SECURITY.md`](SECURITY.md) rather than opening a public issue.

## License

[MIT](LICENSE) © 2026 Paulo Henrique.

Reference projects cloned under `knowledge-base/references/` retain their original licenses (e.g. CC-BY-4.0 for documentation) and are study material only — not redistributed as part of this project.
