# Discover Edge Case Review — m3-ssrf-guard

Date: 2026-06-20
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/m3-ssrf-guard-plan.md
Research questions analyzed: 5
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

All cited paths (opencode webfetch + test, codex urllib, in-repo path-guard + path-safety, web-fetch.ts) verified to exist by the baseline exploration.

## MUST FIX

(none — paths resolve, all 4 corners have ≥ 1 question, 5 ≤ 15, no corner empty. The clean-slate reality (no reference implements SSRF) is already handled by ADR D2 + the Q5 honesty gate.)

## SHOULD TEST

### EC-1: DNS rebinding (TOCTOU) — screen-then-fetch race
- **Affected question:** Q5
- **Suggested halt-loop checkpoint:** when designing `resolveAndScreen`, the blueprint MUST decide the TOCTOU mitigation: a naive `resolve(host) → screen → fetch(host)` re-resolves DNS at fetch time, so an attacker pointing `evil.com` at a public IP during screening and at `127.0.0.1` at fetch time bypasses the guard. The canonical fix is to CONNECT to the screened IP (pin the resolved address) OR re-screen the actual socket peer. Record the decision (pin-resolved-IP vs accept-residual-risk) as a blueprint ADR; do not silently ignore it.

### EC-2: alternate IP encodings + IPv4-mapped IPv6
- **Affected question:** Q5
- **Suggested halt-loop checkpoint:** the screen must normalize before range-checking: decimal (`2130706433` = 127.0.0.1), octal (`0177.0.0.1`), hex (`0x7f.0.0.1`), shortened (`127.1`), and IPv4-mapped IPv6 (`::ffff:127.0.0.1`). The blueprint's block-list must operate on the PARSED/normalized address (via `node:net` / `node:dns` resolution to canonical form), not the raw host string. Pin a test per encoding.

## DOCUMENT

### EC-3: no reference implements SSRF — Techniques corner is pattern+standard, not implementation-comparison
- **Accepted risk:** Q5's Techniques corner cites the SDK path-guard (PATTERN) + opencode/codex GAPS (counter-examples) + the canonical SSRF defense (the standard), NOT 2 reference implementations of an SSRF guard (none exist in scope). This is the honest citation shape for a clean-slate security item; ADR D2 + the Q5 honesty gate already lock it. `/discover-confidence` will see real citations (path-guard, opencode webfetch, codex) even though none implement the technique.

### EC-4: `reference/` (singular) vs the golden-rule checker's `references/` (plural)
- **Accepted risk:** the SDK reference tree is `.claude/knowledge-base/reference/` (singular); the checker keys on `references/` (plural). All cited paths are REAL; the mismatch means the checker treats them as prose (no fabrication flag) — pre-existing divergence under which M1-3/M1-4/M1-5/M2-1 discovery plans passed. Accepted (identical to prior findings).

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 0 | 0 | 0 | 0 |
| Q2 | 0 | 0 | 0 | 0 |
| Q3 | 0 | 0 | 0 | 0 |
| Q4 | 0 | 0 | 0 | 0 |
| Q5 | 2 | 0 | EC-1, EC-2 | EC-3 |
| (plan-wide) | 1 | 0 | 0 | EC-4 |

**Verdict:** DISCOVERY PLAN OK (no MUST FIX; 2 SHOULD-TEST checkpoints — DNS-rebinding TOCTOU + alternate-IP-encodings — to fold into the execute halt-loop so the blueprint's design addresses them)
