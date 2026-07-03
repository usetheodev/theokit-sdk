# Dogfood manifest — theokit ecosystem

The single anchor scenario that, if it works, justifies the open-stack claim.
Read by `/dogfood` against `rules/dogfood-golden-rule.md`.

## Anchor: open-stack-agent

**Slug:** `open-stack-agent`

**Status:** `wired`

> `wired` (not `running`): the anchor is exercised by a real, timed manual smoke
> against real infrastructure (OpenRouter) — see the evidence below. `running`
> ("actively used by the team on real infrastructure", golden rule §2) is the
> operator's attestation and the bar for a v1.0/GA "production-ready" claim; it is
> deliberately NOT self-declared from a single cycle run (that would be dogfood
> theatre the golden rule forbids).

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
OpenRouter). This is the first baseline; the metric itself is proposed and awaits
team ratification (ROADMAP `[UNRESOLVED]`), so it is recorded as a baseline, not a
committed SLO.

## Operator sign-off pending (surfaced, not faked)
- Flip Status `wired` → `running` once the team uses the anchor on real infra on an ongoing basis.
- Ratify `time-to-first-working-agent` as THE north-star (or replace it).
- Only then does a `production-ready`/GA claim clear `public-copy.md §3` + `dogfood-golden-rule` hard caps.
