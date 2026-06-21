# Review — m4-categorized-memory (M4-3)

**Date:** 2026-06-21
**Verdict:** READY_TO_MERGE
**Commits:** 809418a (impl) + 288f32b (review-fix)
**Plan:** knowledge-base/plans/m4-categorized-memory-plan.md (plan-confidence SHIPPABLE 96.0)
**Code-quality:** PASS

## Method

Two independent FAANG-level reviewers (read-only), in parallel — architecture/cross-validation/concurrency + tests/wiring/edge-cases. BOTH independently surfaced the same HIGH (multiline fact round-trip corruption), and reviewer B empirically verified the EC-1 concurrency test is rigorous (lost 7/8 facts without the mutex).

## Findings adjudicated

| # | Sev | Source | Finding | Resolution |
|---|---|---|---|---|
| 1 | **HIGH** | A + B (both) | Silent data loss: a fact containing a newline (or a `- ` / `## ` line) split or truncated on `list()` because the `## Facts` bullet parse is line-based. `add("user","l1\nl2")` → `list()` returned multiple/truncated facts. | **FIXED** (288f32b): `add` encodes `\`/`\r`/`\n` before storing the single bullet; `list` decodes (single-regex pass). A multiline / heading-like / literal-backslash fact now round-trips as exactly one fact. Regression tests added for all three. |
| 2 | LOW | B | redaction test only asserted the token is absent (a bug dropping the whole line would pass). | **FIXED** (288f32b): asserts the masked fact line survives (`- my key is `) + `list` returns 1 fact with the masked text. |
| 3 | LOW | B | "unknown-category writes nothing" only checked `list()===[]` (can't observe a stray file). | **FIXED** (288f32b): asserts `readdir(root)` is empty — no file created at all. |
| 4 | INFO | B | prototype-key category names (`constructor`/`__proto__`) safety untested. | **Hardened** (288f32b): added a `constructor`-category round-trip test (Set-based validation is prototype-safe; `__proto__` is rejected by the identifier grammar). |
| 5 | LOW | A | `header()` frontmatter writes the raw (declared) category while the filename is sanitized. | Accepted — `list()` re-tags from the declared category (the loop var), so the returned `category` MATCHES the frontmatter; the filename being lowercased is a filesystem detail. The frontmatter is consistent with the read value. No churn. |
| 6 | INFO | A | `docs.md` not updated. | Accepted — `docs.md` is the `@theokit/sdk` public-API contract and documents no `@theokit/sdk-memory` surface; adding the lone sdk-memory entry there would be out of place. The CHANGELOG entry + changeset (the package's canonical contract) fully document the API. |
| 7 | INFO | A,B | EC-1 concurrency (withCwdMutex), DIP, no-zod validation, backward-compat (optional `category?`), path-traversal safety (closed taxonomy + sanitizeIdentifier) — all verified correct; the concurrency test verified to genuinely fail without the mutex. | No action. |

## Verdict rationale

Both reviewers returned NEEDS_FIXES solely on finding #1 (the multiline round-trip HIGH). #1 is fixed (encode/decode) with regression tests for newline, heading-like, and literal-backslash facts; the previously-weak assertions are strengthened; ADRs D1–D6 are all verified delivered; the concurrency design (D6/withCwdMutex) was independently confirmed rigorous. Everything else was rated solid by both reviewers.

## Validation (post-fix)

- typecheck: clean (0 errors)
- categorized-memory tests: 16 passed
- full sdk-memory suite: **340 passed / 43 files** (no regression — baseline 324; +16 M4-3 tests)
- biome clean (decodeFact refactored to a single regex to satisfy cognitive-complexity ≤ 10); code-quality PASS
- Coverage Matrix 9/9.

**Verdict:** READY_TO_MERGE
