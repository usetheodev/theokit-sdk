# Blueprint: M8 Ecosystem GA readiness (the closer)

> **Version 1.0** — DISCOVER for M8, the final milestone. Prove the open stack with a `/dogfood` anchor + coherent cross-pillar docs + a baselined north-star. Some DoD elements are genuinely operator-gated (surfaced below); the rest is tractable now.

**Slug:** `m8-ecosystem-ga-readiness`
**Generated:** 2026-07-03

## Finding 1 — M8 DoD (3 items) + dependency state

1. **`/dogfood` anchor exercises all 4 pillars on real infra with fresh evidence.**
2. **Unified cross-pillar docs** (front door explaining the 4-pillar composition + honest pre-release labels).
3. **North-star metric baselined** (`time-to-first-working-agent`).

Deps: M4, M5, M6 (M7 optional — cloud may still be pre-release at GA). M0-M4, M6, M7
are done; M5's hook is committed (theo-ui `9be597f`) but its final barrel/devDep
integration awaits theo-ui's in-flight refactor (not fully `[x]`).

## Finding 2 — What EXISTS vs MISSING (evidence-backed)

- **`/dogfood` skill + golden rule**: present in all 4 repos (`skills/dogfood/SKILL.md`, `rules/dogfood-golden-rule.md`). The golden rule is still a **template** (`§1 Slug: <anchor-slug>` unfilled). Hard caps: `anchor_missing`, `anchor_not_running`, `no_anchor_evidence`, `anchor_evidence_stale`. Status vocab: `planned|wired|running|paused|abandoned`. **No `knowledge-base/dogfood/manifest.md` exists in any repo** → `/dogfood` would emit `EVIDENCE_INSUFFICIENT (manifest_missing)`.
- **Evidence**: theokit-sdk has M4/M5/M6/M7 evidence files (fresh, 2026-07-03) under `dogfood/evidence/`; theo-ui + theokit-plugins evidence dirs are empty.
- **Cross-pillar front door**: `theokit-tools/ROADMAP.md` has the pillar map + the honesty caveat (lines 45-47: "cross-pillar integrations are roadmap items, not shipped wiring"). Per-pillar `CLAUDE.md` lock the narrative. **No git-tracked ecosystem README/PITCH front door** (`theokit-tools/` is NOT a git repo — the front door must live in a pillar repo; the SDK README is the natural Harness front door).
- **North-star**: proposed `time-to-first-working-agent` (ROADMAP:88-90) but explicitly `[UNRESOLVED]` (ROADMAP:279 — "confirm before M8 baselines it"). No baseline measured.
- **Public-copy honesty**: SDK README/PITCH carry a "production" status; `public-copy.md §3` bans unqualified `production-ready` until sustained real-production evidence. Cloud "production" conflicts with M7 (pre-release, contract-only).

## Finding 3 — Anchor feasibility (runnable today)

The open-stack anchor CAN be exercised end-to-end on real infra for **3 of 4 pillars**
(cloud/Runtime is pre-release — DoD allows "M7 optional"):

- **Harness (SDK)**: `Agent.create()+send()` against OpenRouter — validated repeatedly this session (M4/M5). 36 examples ship (`packages/sdk/examples/`).
- **Skills (plugins)**: 10 plugins published to npm (M6); an auth provider or a plugin tool composes with the SDK.
- **UI (theo-ui)**: `useAgentStream` hook consumes `Run.stream()` — validated (M5 demo).
- **Runtime (cloud)**: pre-release (contract-only, M7) — the anchor documents it as pre-release, not exercised live.

A real anchor: create an SDK agent (Harness) on the local runtime with a real
OpenRouter key, drive a send that the `useAgentStream` mapper (UI) renders, and
measure wall-clock from process start to the first `text_delta` = the north-star
`time-to-first-working-agent` proxy. That single run is fresh evidence for DoD #1
(3 shippable pillars) + the DoD #3 baseline.

## Finding 4 — Genuinely operator-gated items (SURFACE, do not fake)

Per Rule 1/3 + `public-copy.md` + `dogfood-golden-rule`:

- **Anchor `running` status** = "actively used by the team on real infrastructure" (golden rule §2). A single run by the cycle is honestly `wired` (invoked in a manual smoke), NOT `running` (sustained team usage). Only the operator can attest `running` → the v1.0/GA claim.
- **North-star ratification**: `[UNRESOLVED]` in the ROADMAP — the operator confirms `time-to-first-working-agent` (or picks another) before it is the committed north-star. The DoD names it, so a BASELINE can be measured now; ratification is the operator's.
- **GA `production-ready` claim**: needs sustained real-production evidence (`public-copy.md §3`) — an operator attestation, not a cycle output. Until then, copy stays honest ("designed for production HA scenarios", cloud pre-release).
- **Narrative decision**: 4-pillar (ROADMAP) vs the funnel framing (SDK PITCH:6 deprecated 4-pillar). The front-door doc should use the framing the operator has locked — the ROADMAP still uses 4-pillar, so this blueprint proceeds with it while flagging the split.

## ADRs

### ADR-1 — M8 ships the TRACTABLE substance now; GA-status attestations are operator-gated
Produce the dogfood manifest + anchor + FRESH real-LLM open-stack evidence, the
front-door 4-pillar doc (in the SDK README — git-tracked), and a MEASURED north-star
baseline. Set the anchor Status honestly to `wired` (real smoke, not sustained team
usage). Surface `running`/GA/ratification as operator attestations — faking them
violates the mandate's own "SEM WORKAROUNDS / 100% functional evidence." **Rejected:**
declaring Status `running` + a GA "production-ready" claim from a single cycle run —
that is exactly the dogfood-theatre the golden rule forbids.

### ADR-2 — The SDK README is the cross-pillar front door (theokit-tools is not a git repo)
DoD #2's "unified front door" must be committable; `theokit-tools/` has no `.git`.
The SDK (Harness) is the load-bearing pillar with a public README — strengthen its
4-pillar composition section + honest pre-release labels there. **Rejected:** an
uncommittable `theokit-tools/README.md`.

## Coverage Corner 1 — Integration tests
The anchor run itself (real OpenRouter, timed) is the integration evidence; the
existing M4/M5 pillar tests remain the regression floor.

## Coverage Corner 2 — Dependencies
None new — reuse the published SDK + plugins + a real OpenRouter key (env, scrubbed).

## Coverage Corner 3 — Tools
`/dogfood` golden rule + manifest; the SDK examples; `public-copy-lint`.

## Coverage Corner 4 — Techniques
Honest dogfood (`wired` not `running` from a single run); measured baseline (not
estimated); operator-gated items surfaced, not faked.

## Honest scope note
M8 is the GA-readiness closer. Its tractable substance (manifest + anchor + fresh
open-stack real-LLM evidence + front-door 4-pillar doc + measured north-star
baseline) is deliverable now. Its GA-STATUS elements (anchor `running` = sustained
team usage; ratified north-star; `production-ready` sustained-production claim) are
operator attestations — by the dogfood + public-copy contracts, they cannot be
produced by a cycle run without becoming dogfood theatre. The milestone reaches
"substance complete + operator sign-off pending" honestly.

## Related
- `rules/dogfood-golden-rule.md` (anchor + status + evidence contract), `rules/public-copy.md` (GA-claim gate).
- Ecosystem ROADMAP M8 DoD; `[UNRESOLVED]` north-star (ROADMAP:279).
- Prior evidence: `dogfood/evidence/m4..m7-*.md`.
