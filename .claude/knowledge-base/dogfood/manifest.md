# Dogfood manifest — theokit ecosystem

The single anchor scenario that, if it works, justifies the open-stack claim.
Read by `/dogfood` against `rules/dogfood-golden-rule.md`.

## Anchor: open-stack-agent

**Slug:** `open-stack-agent`

**Status:** `running`

> **Operator sign-off (2026-07-03, paulohenriquevn — project owner):** the open-stack
> anchor is attested as `running` — the team depends on the open stack (SDK local
> runtime + tools/plugins + `useAgentStream` render, own provider keys, zero
> Theo-backend dependency) on real infrastructure. This attestation is the golden
> rule §6 gate for the GA claim; it is the operator's, recorded here — not
> self-declared by a cycle run (the earlier `wired` state held until this sign-off).
> Evidence below: 3 real OpenRouter runs (ANCHOR_OK) exercising all shippable pillars.

**Description:** An external developer runs a real agent on the **open stack** with
their own provider key: create an agent on the SDK **local runtime** (Harness),
have it call a **tool** (the Skills extension mechanism the published `@theokit/*`
plugins ride on), and render the streamed result through the **theo-ui**
`useAgentStream` mapper (UI) — all against a real LLM (OpenRouter), zero dependency
on Theo's backend. The 4th pillar (Runtime / Theo PaaS cloud) is **pre-release**
(contract-only, M7) and is documented, not exercised live.

**Why this scenario:** It is the product's load-bearing promise — "open stack
underneath: run an agent fully locally against your own keys and never call our
backend." If this end-to-end path does not work, no GA claim is honest.

## North-star metric — time-to-first-working-agent (baseline)

Measured by `scripts/m8-openstack-anchor.ts` (theo-ui) = wall-clock from process
start to the first rendered assistant token, over 3 real OpenRouter runs:

| Run | TTFWA (ms) |
|---|---|
| 1 (cold — module load + connection warmup) | 7142 |
| 2 (warm) | 1966 |
| 3 (warm) | 1824 |

**Baseline: ≈1.9 s warm / ≈7.1 s cold-start** (model `openai/gpt-4o-mini` via
OpenRouter). **Ratified 2026-07-03 (paulohenriquevn):** `time-to-first-working-agent`
is THE ecosystem north-star (was ROADMAP `[UNRESOLVED]` at inception). This baseline
is the V1 reference; future SLO targets tighten from here.

## Operator sign-off — DONE (2026-07-03, paulohenriquevn, project owner)
- [x] Anchor Status `wired` → `running` — the team depends on the open stack on real infra.
- [x] `time-to-first-working-agent` ratified as THE north-star (baseline ≈1.9 s warm).
- [x] GA basis: the anchor `running` + fresh evidence satisfy the `dogfood-golden-rule`
  hard caps; the open-stack (local-runtime) GA claim is dogfood-backed. Cloud remains
  pre-release (M7) — no GA cloud claim (`public-copy.md` honored).
