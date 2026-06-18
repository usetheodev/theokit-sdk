# D431 — Revoke "decorators mandatory via `@theokit/di`"; factory functions are the canonical API

- **Status:** Accepted
- **Date:** 2026-06-18
- **Plan:** `monorepo-cohesion-split`
- **Supersedes:** the inviolable rule "Decorators mandatory for agentic features" (project `CLAUDE.md` rule 9, established 2026-06-10) and the `feedback_decorators_mandatory` memory.

## Decision

Rescind the rule that every agentic capability MUST ship a `@Decorator` API surface via `@theokit/di`. Going forward:

- **Factory functions** (`defineTool`, `createAgentFactory`, `definePlugin`, etc.) are the single canonical, always-present API for every Harness capability.
- **Decorators are an OPTIONAL convenience layer** a consumer may add via the externally-published `@theokit/di`, which leaves the Harness monorepo for the `theokit-backend-dx` repo (per ADR D432).
- The Harness (`@theokit/sdk`) MUST NOT depend on `@theokit/di`.

## Rationale

The 2026-06-10 rule forced the entire ecosystem to ship and maintain a generic IoC container (`@theokit/di`), which in turn "justified" a cascade of generic backend-DX packages — `di-agent`, `orm`, and a planned `http-decorators` — each a hand-rolled re-implementation of capabilities that mature libraries (`inversify`, `tsyringe`, `NestJS`, `drizzle`) already provide. This:

- Violates **Unbreakable Rule 7/9 (don't reinvent the wheel)** — re-implementing a DI container + ORM + HTTP decorators inside an Agent-AI SDK.
- Violates **KISS + YAGNI** — the SDK needs factory functions to build agents; a DI framework is incidental complexity with no proven demand.
- Contradicts the **project mantra** ("LEGO pieces to build any agent, never a pre-assembled app") and the **four-pillar split** (the SDK is the Harness, not a backend framework).

Removing the rule removes the structural pull that generated the Backend-DX cluster, which the `monorepo-cohesion-split` plan then extracts.

## Alternatives considered

- **Keep the rule; keep `@theokit/di` as an external dependency of the Harness** — rejected: re-introduces a generic-framework dependency in the Harness and keeps the per-feature "must also ship decorators" tax.
- **Keep decorators via a ~50-LoC internal helper (no full container)** — rejected: still mandates a second API surface per feature with no proven demand (YAGNI); the project owner chose full revocation.
- **Leave the rule, defer the decision** — rejected: the rule is the root cause the split is trying to eliminate; deferring blocks the cohesion goal.

## Consequences

- **Enables** a cohesive Harness with one primitive API surface and no generic-framework dependency.
- **Constrains:** any code or docs advertising decorator-first DX must be reframed as factory-first; the `feedback_decorators_mandatory` memory is rewritten/retired; the `quality-review` skill no longer flags a missing decorator surface.
- `@theokit/di`, `@theokit/di-agent`, `@theokit/orm` continue to exist as published packages in `theokit-backend-dx`, where decorators remain a first-class (optional) DX for consumers who opt in.
