# D35 — Validation rubric: quantitative metrics per pillar

**Status:** Decided
**Date:** 2026-05-17

## Decision

Each of the five SDK pillars validated in v1.1 ships with a NUMERIC
acceptance metric, not a binary checkbox. The pillars and thresholds:

- **Persistence-first**: 100 random-timed `kill -9` injections during
  `agent.send` MUST produce 100 successful recoveries (registry.json
  parses, no half-written entries). Target: 100/100.
- **MCP-first**: AT LEAST 3 distinct MCP servers (stdio AND HTTP
  transports combined) MUST execute a full `agent.send` cycle with a
  real LLM and produce verifiable output. Target: ≥3 servers passing.
- **Memory-as-subsystem**: Ingest 50 facts, run `Memory.runDreamingSweep`,
  achieve ≥5 distinct clusters; run 20 active-recall query scenarios,
  achieve ≥80% hit rate (correct fact surfaces in `<active-memory>`).
- **DX for chat bots**: At least N=2 chat bot examples exist (telegram-pro
  + cli-bot) using all 4 DX helpers; each persists a session and
  recovers after restart.
- **Ambient safety**: 20 adversarial scenarios × 2 sandbox configs
  (enabled + disabled) = 40 outcomes. Sandbox-enabled column MUST be
  40/40 in `blocked` or `allowed-but-safe`. Sandbox-disabled column
  documents the difference so consumers understand the safety
  contribution of sandbox.

Each metric is captured in a snapshot under
`.claude/knowledge-base/reviews/{pillar}-{date}.md`.

## Rationale

"Restart-proof", "MCP-first", "ambient safety" — these phrases evaporate
without numbers. A consumer reading the SDK README gets nothing from
"we validated persistence"; they get something concrete from "100/100
chaos-kill recoveries".

Quantitative metrics:

- Are auditable: future SDK versions can re-run the scripts and detect
  regression.
- Become marketing surface area: README badges, blog posts, release
  notes can quote them.
- Force precision in the test design: vague "memory works" becomes
  "≥80% hit rate on 20 representative semantic queries".

Pillar thresholds are deliberately conservative — they're "v1.1
baseline" numbers, not absolute benchmarks. Future versions can raise
them or refine the scenarios.

## Consequences

- Each pillar gets a reusable script under `tools/` that CI can run on
  a nightly cadence to detect regression.
- Snapshots become part of the audit trail. A snapshot showing
  "memory recall = 75%" doesn't block the release if it documents WHY
  (e.g., scenario design imperfect) but creates an explicit ticket for
  follow-up.
- Marketing claims tied to the rubric are honest and reviewable. We
  avoid the "we love our SDK" energy of vendor docs.
- Failure to hit a target is NOT a release blocker BUT a tracked debt
  with a known timeline (next minor).
