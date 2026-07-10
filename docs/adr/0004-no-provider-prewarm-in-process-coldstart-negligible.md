---
status: accepted
date: 2026-07-09
deciders: paulo
consulted: claude
informed: theokit-maintainers
---

# ADR 0004: No provider `prewarm()` API — in-process cold-start is negligible (measured)

## Context and Problem Statement

The Anthropic Agent SDK exposes `startup()` / `WarmQuery` to amortize **subprocess spawn** cost
before the first prompt. Milestone **SE6** (SDK Evolution roadmap) asks whether `@theokit/sdk` needs
an in-process analog: prewarm the provider chain / precache model capabilities / open the connection
ahead of the first `Run.stream()`, so the first run isn't slowed by cold provider resolution.

SE6 is a **GATED** milestone: its DoD requires **measuring the cold-start cost first**, with numbers,
and building a `prewarm()` API **only if** the cost is material (defined threshold: **50 ms**). The
honest prior is "likely a no-op" — `@theokit/sdk` is in-process by design, so there is no subprocess
spawn to amortize.

## Decision Drivers

- We have **no subprocess**. The Anthropic warm-start exists to hide process-spawn latency; that cost
  simply does not exist in the in-process model (`streamAgentTurnInProcess`).
- YAGNI: an API must justify itself with a number, not a ported concept.
- The first-token latency a user actually feels is dominated by the **LLM network round-trip**
  (hundreds of ms to seconds) — which a `prewarm()` cannot reduce.

## Measurement

Harness: `packages/sdk/scripts/measure-cold-start.mts` (reproducible; fixture runtime, **no network**,
so the numbers are SDK-internal cold-start, not provider inference). Node v22.22.2, 12 runs, two
independent executions:

| Component | Run 1 | Run 2 | Notes |
|---|---:|---:|---|
| Module import | 368.7 ms | 193.8 ms | one-time at `import`, BEFORE any run — not reducible by a runtime `prewarm()` |
| Provider registration (`registerBuiltins`, one-shot) | 2.26 ms | 2.07 ms | already cached after first touch |
| `Agent.create` cold Δ (cold − warm median) | 2.33 ms | 2.49 ms | |
| First `send()` cold Δ (cold − warm median) | 1.84 ms | 2.86 ms | |
| **Prewarmable ceiling (Δcreate + Δrun)** | **4.17 ms** | **5.35 ms** | the MOST a `prewarm()` could save on run #1 |
| Materiality threshold | 50 ms | 50 ms | |

**Verdict: NEGLIGIBLE** (4–5 ms ≪ 50 ms) in both runs.

### Interpretation

- The only cost a runtime `prewarm()` could amortize is the ~4–5 ms delta the first `create`+`send`
  pay over a warm one (provider registration + lazy module init). That is an order of magnitude below
  the materiality threshold and invisible next to the LLM round-trip.
- The largest number — module import (~200–370 ms) — is **not** prewarmable by a runtime API: it is
  the cost of `import`-ing the SDK, which has already happened by the time any `prewarm()` could run.
  It is a one-time process cost, not a per-first-token cost, and is the same for every startup path.
- Connection setup is not separately material: the fixture path exercises no socket, and in the real
  path undici keep-alive amortizes it across a session — a one-off connection open is dwarfed by the
  inference latency of the very first request that opens it.

## Decision Outcome

Chosen option: **do NOT ship a `prewarm()` API.** SE6 closes with the measurement as evidence. The
in-process model's minimal cold-start (4–5 ms of amortizable overhead) is precisely the advantage over
the subprocess model — there is nothing worth a public API to hide.

### Consequences

- **Positive:** no speculative API for a non-problem (YAGNI); the measurement harness stays in-tree as
  reproducible evidence and a regression tripwire — if a future change inflates cold-start past 50 ms,
  re-run it and reopen.
- **Negative:** none. Consumers needing to hide the module-import cost do so at their own layer
  (e.g. importing `@theokit/sdk` during app boot), which is a framework/app concern, not a runtime API.

### Re-evaluation triggers (any one reopens)

1. `packages/sdk/scripts/measure-cold-start.mts` reports a prewarmable ceiling **> 50 ms** on
   supported hardware.
2. A concrete consumer measures a first-token cold-start problem attributable to SDK-internal
   resolution (not network), reproducible with the harness.
3. The SDK adds a genuinely expensive one-time per-run resolution step (e.g. remote capability
   discovery) whose cost the harness shows crossing the threshold.

## More Information

- Roadmap: SE6 (`ROADMAP.md`, "SDK Evolution (post-Harness)"), closed by this ADR.
- Reproduce: `node_modules/.bin/tsx packages/sdk/scripts/measure-cold-start.mts`.
- Related non-goal: "Subprocess / CLI-wrapper model + spawn warm-start" (roadmap "Explicitly out of
  scope") — this ADR is the in-process counterpart's evidence-backed close.
