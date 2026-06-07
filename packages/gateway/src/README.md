# `@theokit/gateway` — internal layout

Base contracts + routing primitives shared by every platform adapter package (`@theokit/gateway-telegram`, `@theokit/gateway-discord`, `@theokit/gateway-slack`, etc.). Each concrete adapter package consumes the types and helpers exported here, then attaches its platform-specific transport.

## Layout — 6 single-file sub-folders (intentional, FO#4 acknowledged)

```
src/
├── adapter/base.ts          — BasePlatformAdapter abstract contract (T1.2, ADR D172)
├── delivery/router.ts       — DeliveryRouter outbound dispatch by platform (T3.1, ADR D175)
├── hooks/types.ts           — Gateway hook contract — own kind, not Plugin.kind (T4.1, ADRs D176/D177)
├── runner/gateway-runner.ts — GatewayRunner top-level orchestrator (T1.3, ADR D170+)
├── session/router.ts        — SessionRouter pure MessageEvent → agentId routing (T2.1, ADR D174)
├── types/message-event.ts   — MessageEvent canonical inbound shape (T1.1, ADR D173)
└── index.ts                 — barrel
```

## Auditor-acknowledged structure (FO#4, INFO-level once documented)

The 2026-06-06 architecture audit (`/loop-architecture-review` Phase 2 structure-auditor) flagged this directory as a **lonely-folder cluster** — 6 sub-folders each containing exactly 1 source file. Per `rules/cycle-rule-schema.md` heuristic legend, "lonely_folder: files == 1 AND no subfolders. Often a sign of over-folding."

This README documents the intentional choice (plan `arch-review-fixes-2026-06-06` T10.2):

### Why the 6 sub-folders stay (NOT folded into root)

1. **Bounded future extensibility scaffold.** Each sub-folder represents a stable semantic *role* (adapter, delivery, hooks, runner, session, types). Future additions stay within their semantic slot rather than competing for namespace at the package root:
   - `adapter/` will grow as new platform-agnostic base behaviour is hoisted (e.g., common reconnect protocol, message-deduplication helpers).
   - `delivery/` will grow if outbound paths diverge (cron-bound delivery, broadcast vs unicast, signed-URL delivery).
   - `hooks/` will grow as the contract surface expands (e.g., pre-handoff hook, post-error hook).
   - `runner/` will grow if multi-tenant runner shapes ship (per-process vs per-workspace orchestrators).
   - `session/` will grow as routing strategies are added (`agentId-from-thread`, `agentId-from-deeplink`).
   - `types/` will grow as the canonical inbound shape gains discriminated variants per platform.

2. **Findability over file-count economy.** The auditor's "files-per-folder ≤ 25" + "lonely_folder" heuristics target *findability*, not file-count minimization. With 6 sub-folders, a maintainer scanning `gateway/src/` immediately sees the package's role taxonomy. Folding into a flat root (`adapter-base.ts`, `delivery-router.ts`, `hooks-types.ts`, `runner-gateway-runner.ts`, `session-router.ts`, `types-message-event.ts`, `index.ts`) trades visible role taxonomy for a flatter tree — net loss on findability per `architecture.md § 3` module-cohesion principle.

3. **ADR alignment.** Each sub-folder maps 1:1 to an ADR (D170+ family). Maintainers cross-referencing ADRs find the implementation in the matching folder. Flattening would obscure that ADR-to-code mapping at the directory level.

4. **Consistency with concrete adapter packages.** `@theokit/gateway-telegram/src/`, `@theokit/gateway-discord/src/`, etc., follow analogous role-named taxonomy (adapter.ts, ingest.ts, deliver.ts, split.ts). Folding the base package would create an asymmetry between base and concrete adapters.

### Trigger to re-evaluate

If, after 12 months, any of the 6 sub-folders still contains exactly 1 file AND no ADR has been registered to grow it (D170+ pipeline empty), the per-folder rationale above will be stale. Re-evaluate fold-vs-keep at that point.

## Auditor record

- Plan: `arch-review-fixes-2026-06-06` § Phase 10 / T10.2
- Audit DB row: `folder_observations.id=4` @ `packages/gateway/src/` (lonely_folder, MEDIUM severity → INFO once documented)
- Audit report: `architecture-output/final_report.md § Findings by dimension` FO#4

## Related ADRs

- D170 — `@theokit/gateway` workspace-package separation
- D171 — Each platform adapter is its own peer-dep workspace package
- D172 — `BasePlatformAdapter` abstract class
- D173 — `MessageEvent` discriminated union by `platform`
- D174 — `SessionRouter` composes `Agent.resume`
- D175 — `DeliveryRouter` composes `Cron`
- D176 — Gateway hooks are an own contract, NOT a `Plugin.kind`
- D177 — Hook signature mirrors `pre_tool_call` veto pattern
