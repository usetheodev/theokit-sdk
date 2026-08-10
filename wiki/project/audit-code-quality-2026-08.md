---
type: Audit Record
title: "Audit: code quality 2026-08"
description: The 2026-08-05 code-quality audit — PASS_WITH_CAVEATS, and the three of four detectors that never reported, stated rather than folded into the pass.
tags: [project, audit, code-quality, honesty, tooling]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: audit
    resource: .claude/knowledge-base/audits/issue-sweep-2026-08-code-quality-2026-08-05.md, absorbed into this bundle 2026-08-06
    title: Code-quality audit record
    author: process:code-quality
    last_modified: 2026-08-05
---

# Scope

**Date:** 2026-08-05 · **Mode:** standalone · **Scope:** the working tree at `workspace`
(10 commits since `8beb61da6`; 68 files, +2531 / −245).

```json
{"verdict": "PASS_WITH_CAVEATS", "score_cap": 89}
```

This verdict unblocks the review. The caveats below are stated explicitly rather than folded
into the pass.

# Severity counts

| Severity | Count |
| --- | --- |
| HARD | 0 |
| SOFT_CAP | 0 |
| SOFT_FLOOR | 69 |
| INFO | 0 |

`hard_caps_triggered` lists `symbol_fab_unverifiable_typescript`. Read carefully: that is
**unverifiable**, not **fabricated**. `severity_counts.HARD` is 0 and no
`symbol_fabrication_typescript` finding exists — the identifier records that the detector could
not complete member-access introspection for TypeScript, which its own roadmap lists as
deferred. It is a declared coverage limit of the detector, not a defect in the audited code.

That distinction is the whole point of the record: a tool that says "I could not check" is
reporting something different from a tool that says "I checked and it is clean", and a process
that collapses them starts reporting unchecked work as checked.

# Detectors — what actually ran

| Detector | Ran? | Result |
| --- | --- | --- |
| D1 — dead code | **NO** | absent from the results. No dead-code claim can be made from this run. |
| D2 — symbol fabrication | yes | 69 findings, all SOFT_FLOOR; 0 fabrications |
| D3 — cross-package wiring | **NO** | absent. No orphan-export claim can be made. |
| D4 — mutation testing | **NO** | requires a plan's critical-paths section; unavailable |

**This is the caveat that matters.** `PASS_WITH_CAVEATS` here means "D2 found no fabricated
symbols", NOT "the code is free of dead exports". Three of four detectors did not report, and
the claim they would have supported is therefore not made.

Only TypeScript was audited; python, rust and go were skipped for absent manifests.

# Deviations, stated rather than hidden

1. **Standalone mode, not plan-bound.** No plan existed — this was an issue-driven sweep, not a
   planning cycle. Consequence: mutation testing had no critical paths to scope to and did not
   run.

2. **The project's language-rule file is unusable by the skill — a pre-existing repo defect.**
   The runner aborts on `languages.txt malformed line: 'typescript'`: the project file uses one
   identifier per line while the parser expects a four-column shape. The two formats are
   incompatible, so **the audit had never been runnable in this repository** — a sufficient
   explanation for why the audits directory was empty before that day. The run used the skill
   defaults instead, which is behaviourally equivalent here (only `package.json` exists at
   root) and avoids mutating a project rule file during a review. The file's own header also
   claims a consumer that grep finds no trace of. Both were filed as findings rather than fixed
   in place, since the audit is read-only by contract.

3. **The markdown report was hand-assembled from the emitted JSON**, because standalone mode
   produced no file. Every number is copied from the real detector run, not estimated.

# Handoff

The verdict allowed [review: issue-sweep 2026-08](/project/review-issue-sweep-2026-08.md) to
proceed, carrying two caveats forward: the wiring agent must not treat this audit as evidence
of dead-code or orphan-export cleanliness, and the language-file format collision is a
repo-level defect that outlives the sweep.

# Why it is in the wiki

It is a worked example of the discipline
[governance](/operations/governance.md) asks for: a gate that reports what it did **not**
check is more useful than one that reports a clean pass, and the difference between
"unverifiable" and "clean" is exactly the difference between
[precision notes](/project/precision-notes.md) and
[capability gaps](/project/capability-gaps.md).[^audit]

[^audit]: Code-quality audit record, 2026-08-05
