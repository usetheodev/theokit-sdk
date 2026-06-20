# Discovery Plan: M3-1 — SSRF guard for `web_fetch`

> **Version 1.1** (discover-edge-cases absorbed: EC-1 DNS-rebinding TOCTOU + EC-2 alternate-IP-encodings folded into halt-loop checkpoints) — Investigate how the in-scope reference web-fetch tools (opencode, codex) handle (or fail to handle) SSRF, and what security-primitive pattern the SDK's own `path-guard` establishes, to design a `resolveAndScreen(host)` network guard + `redirect:"manual"` default-on in a `createGuardedWebFetchTool`. The references are CLEAN-SLATE / counter-examples (none block private IPs; opencode explicitly accepts localhost) — that gap IS the motivation; the borrowed PATTERN comes from the SDK's path-guard + the canonical SSRF defense. Blueprint output: locked guard signature, the block-list ranges, the resolve-all-A-records + redirect-manual technique, and the subpath wiring.

**Slug:** `m3-ssrf-guard`
**Owner:** paulo
**Created:** 2026-06-20
**Time budget:** 3h (per-project breakdown in ADR D1)

## Context

Roadmap gap M3-1 (`docs/gap-audit/ROADMAP.md:121`, high sev, Tema C). Baseline (`packages/sdk-tools/src/web-fetch.ts:26-118`): `createWebFetchTool` validates protocol (http/https, `:54`) but does NO host/IP screening, follows redirects (native fetch default), and never resolves DNS — a textbook SSRF hole (an attacker-controlled URL or a redirect can reach `127.0.0.1`, `169.254.169.254` cloud-metadata, or internal `10.*`/`192.168.*` services). No `resolveAndScreen`, no `node:dns`/`node:net` usage anywhere in sdk-tools. The SDK already ships a security-primitive PATTERN for the filesystem (`packages/sdk/src/internal/security/path-guard.ts` + the public `packages/sdk/src/path-safety.ts` barrel, with typed errors `PathTraversalError`/`ForbiddenPathError` extending `ConfigurationError`) — M3-1 mirrors it for the network. Respects `rules/architecture.md` §2 (DIP: the guard is a domain security primitive) + `rules/no-stubs-no-mocks-no-wired.md` (default-on, wired into the tool).

## Objective

Decide the `resolveAndScreen(host)` signature, the blocked IP-range set, the resolve-all-A-records + `redirect:"manual"` technique, the typed error, and the public surface — backed by the reference baselines (the gap) + the SDK path-guard pattern + the canonical SSRF defense. Success criteria:

- [ ] All research questions answered with citations to `.claude/knowledge-base/reference/` AND the in-repo path-guard/web-fetch
- [ ] Cross-cutting comparison table populated (opencode / codex / SDK path-guard)
- [ ] Recommendations provide ≥ 1 concrete decision proposal per question (esp. the block-list ranges + redirect handling)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/reference/opencode/` | `packages/core/src/tool/webfetch.ts`, `packages/core/test/tool-webfetch.test.ts` | The closest analog web-fetch tool + its tests; the localhost-accepted test is the anti-pattern M3-1 fixes |
| `.claude/knowledge-base/reference/codex/` | `scripts/codex_package/` (the `fetch_codex_v8_artifacts` urllib path) | A second web-fetch baseline (bare urllib, no screening) — confirms the gap is industry-wide |
| (in-repo, not a reference clone) `packages/sdk/src/internal/security/path-guard.ts` + `path-safety.ts` | — | The SDK's OWN security-primitive pattern to mirror (typed errors + public barrel) |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/reference/adk-js/`, `crewAI/` | No web-fetch tool or SSRF screening found (baseline confirmed) — nothing to cite |
| `.claude/knowledge-base/reference/*/{node_modules,dist,build,target,.venv}/` | Build artifacts |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** opencode: 1h, codex: 0.5h, in-repo path-guard + web-fetch: 1.5h.

**Rationale:** opencode's webfetch.ts + tests are the richest analog (and carry the anti-pattern); the in-repo path-guard is the load-bearing PATTERN to mirror, so it gets the deepest read. codex is a quick confirm-the-gap.

**Stop condition — per question:** empty search after 3 query variants → mark BLOCKED with reason, continue. **Per project:** budget exhausted → mark remaining BLOCKED, advance; if all done/blocked, emit BLUEPRINT_BLOCKED (never COMPLETE from a blocked state).

**Anti-pattern:** NEVER fabricate a reference SSRF implementation that does not exist — the honest finding is "the references do NOT screen; the technique is canonical + the pattern is the SDK path-guard."

### D2 — Investigation depth

**Decision:** Read the cited hotspots end-to-end (baseline already produced line-exact anchors); use the canonical SSRF defense (resolve-all-A-records, block private/loopback/link-local/CGNAT/metadata, IPv4-mapped IPv6, redirect:manual) as the technique authority since no in-scope reference implements it.

**Rationale:** the baseline confirmed the references are counter-examples; re-scanning won't find a reference SSRF guard. The blueprint's Techniques corner cites the SDK path-guard (pattern) + the canonical defense (the standard) + the reference gaps (motivation).

**Consequences:** the Techniques corner is "pattern + standard + counter-example", not "compare N implementations" — honest given the clean-slate reality (recorded so `/discover-confidence` understands the citation shape).

## Research Questions

| # | Question | Corner | Reference(s) | Fase A (broad) | Fase B (deep Read) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does opencode test its web-fetch tool, and what does it assert about localhost / private hosts? | tests | opencode | Glob `packages/core/test/tool-webfetch.test.ts` | Read `opencode/packages/core/test/tool-webfetch.test.ts:92-253` (localhost-accepted :121-141, redirect-follow :144-176, oversized :221-253) | Table: test → what it asserts → whether SSRF is tested (it is NOT; localhost accepted) → seeds the SDK's RED SSRF tests |
| Q2 | How does the SDK's path-guard test + structure its blocklist + typed errors? | tests | in-repo path-guard | Read `path-guard.ts` blocklist + error classes | Read `packages/sdk/src/internal/security/path-guard.ts:33-64,267-281` + its tests | The blocklist + typed-error pattern (`ConfigurationError` subclass + `code`) the network guard mirrors |
| Q3 | What do the reference web-fetch tools depend on (tokenizer/lib for screening)? Can a Node guard use only `node:dns`/`node:net` builtins? | deps | opencode, codex | Grep imports in `opencode/.../webfetch.ts` + `codex/.../*.py` | Read the fetch + (absent) screening imports | Per-ref dep list → verdict: zero new deps (node:dns/net builtin) |
| Q4 | What is the module/export shape of opencode's webfetch + the SDK's path-safety barrel? | tools | opencode, in-repo | Read `opencode/.../webfetch.ts:1-100` + `packages/sdk/src/path-safety.ts:1-32` | Read both | Module shapes → decide where `resolveAndScreen` + `createGuardedWebFetchTool` live + how the typed error is exported |
| Q5 | SSRF DEFENSE TECHNIQUE: which IP ranges must be blocked, how to handle DNS (resolve ALL A-records) + IPv4-mapped IPv6 + redirects, and where opencode/codex fail? | techniques | opencode, codex, in-repo path-guard | Read opencode `webfetch.ts:84-96` (protocol-only) + codex urllib path | Read the reference fetch paths (confirm no screening) + map the canonical SSRF block-list onto the SDK | Block-list set (loopback 127.0.0.0/8 + ::1; private 10/172.16/192.168; link-local 169.254 + fe80::; CGNAT 100.64/10; metadata 169.254.169.254; IPv4-mapped ::ffff:) + resolve-all-A-records + `redirect:"manual"` re-screen-per-hop → maps to `resolveAndScreen(host)` design |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q1, Q2 | Covered |
| Dependencies | Q3 | Covered |
| Tools | Q4 | Covered |
| Techniques | Q5 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | every cited path (reference + in-repo) exists | mark Qx BLOCKED "path not found", continue |
| After answering Qx | the Qx blueprint section has ≥ 1 citation | re-iterate Qx (1 retry max) |
| Q5 honesty gate | the technique section cites the SDK path-guard PATTERN + the reference GAPS + names the canonical block-list; does NOT fabricate a reference SSRF implementation | re-iterate; keep the honest counter-example framing |
| EC-1 TOCTOU gate (Q5) | the blueprint states the DNS-rebinding mitigation (pin the screened IP / re-screen the socket peer) as an ADR | re-iterate; add the TOCTOU ADR before closing Q5 |
| EC-2 normalization gate (Q5) | the block-list operates on the PARSED/normalized address (decimal/octal/hex/short/IPv4-mapped-IPv6 all normalized) | re-iterate; record the normalization requirement |
| Before promising complete | all 4 corners have populated sections + ≥ 1 ADR | refuse promise, continue |

## Acceptance Criteria

- [ ] All 5 research questions answered OR explicitly marked BLOCKED with reason
- [ ] Every citation resolves to a real path under `.claude/knowledge-base/reference/` OR a real in-repo path
- [ ] Cross-cutting comparison populated (opencode / codex / SDK path-guard)
- [ ] Blueprint proposes concrete signatures for `resolveAndScreen(host)` + `createGuardedWebFetchTool` + the typed error + the block-list ranges, backed by the path-guard pattern + canonical defense
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS (per `rules/discover-blueprint-golden-rule.md`)
- [ ] No fabricated citations (every `reference/...` + in-repo path resolves)
- [ ] All 4 coverage corners populated
- [ ] Blueprint ADRs cover: guard signature, block-list set, redirect handling, typed error, subpath wiring
