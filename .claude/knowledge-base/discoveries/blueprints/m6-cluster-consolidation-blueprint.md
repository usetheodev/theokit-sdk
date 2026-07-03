# Blueprint: M6 Harness cluster consolidation (gateways · plugins · release train)

> **Version 1.0** — DISCOVER for M6. Two repos (`theokit-gateways` 11 pkgs, `theokit-plugins` 11 pkgs) aligned to the hardened `@theokit/sdk` 2.18.0 Harness + a coordinated Changesets release + plugins ROADMAP reconciliation. Cross-repo, evidence-backed (file:line), both clusters mapped by Explore agents.

**Slug:** `m6-cluster-consolidation`
**Generated:** 2026-07-03
**Repos:** `theokit-gateways` + `theokit-plugins` (both git, `develop`) + `theokit-sdk` (Harness, already at 2.18.0).

## Finding 1 — The consumed SDK API surface is TINY and STABLE across 1.x→2.x

The feared "drift" (top-risk #1) is minimal: both clusters consume a very small, stable slice of `@theokit/sdk`.

- **Gateways (11 pkgs):** the ONLY runtime SDK import is `Security` (`Security.redact(msg)`) at `theokit-gateways/packages/gateway/src/runner/gateway-runner.ts:25,190`. `Security.redact(text, opts?)` is a public static method (ADR D68), present + unchanged in 2.18.0 (`theokit-sdk/packages/sdk/src/security.ts:51`, exported `index.ts:172`). Adapters are SDK-agnostic (wire at the platform-event level). Examples reference `Agent.create` but no core/adapter code does. **0 dead surfaces** (grep found no TODO/FIXME/stub in src; all adapters implement the full `BasePlatformAdapter` contract).
- **Plugins (11 pkgs):** only the 3 auth packages import from the SDK — `AuthProvider, AuthResult, OAuthTransaction` from `@theokit/sdk/server/auth` (`auth-github/src/index.ts:19`, `auth-google`, `auth-magic-link`). Those symbols exist + are stable in 2.18.0 (`theokit-sdk/packages/sdk/src/server/auth/index.ts:26-29`). Other plugins reference the SDK in COMMENTS only (no hard import). Non-SDK plugins: db-drizzle (`@theokit/orm`), email (Resend), forms (`@theokit/react`), payments (Stripe), voice (busboy).

**Consequence:** the code alignment is a **pin bump**, not an API migration. Both clusters build against ANY 2.x because the consumed surface (`Security.redact`, `server/auth` types) is stable across the whole 1.6→2.18 range.

## Finding 2 — One REAL dead/unwired surface (DoD #1 blocker, plugins)

`theokit-plugins/packages/plugin-copilot/package.json:33` peer-deps `@theokit/plugin-rate-limit >=0.1.0` — **a package that does NOT exist** in `packages/` (nor published). `CopilotRateLimitConfig` is a type-only opt-in (`plugin-copilot/src/types.ts:157,161,188`); no runtime wiring. Fix: **remove the phantom peer dep** (make the rate-limit config a documented type-only opt-in) OR create the package (out of M6 scope). Removing is the parsimonious fix (YAGNI — no implementation exists).

Gateways have 0 dead surfaces. Documented deferrals (payments Elements, voice realtime, realtime Y.Doc auto-wire) are honest `deferred to v0.x` notes, not stubs.

## Finding 3 — Plugins ROADMAP + README are STALE (DoD #3 blocker)

`theokit-plugins/ROADMAP.md` declares plugins that DON'T exist here (`plugin-cors`, `plugin-sentry`, `plugin-i18n`) and ignores the 11 that DO. `theokit-plugins/README.md:5` claims the repo is "empty by design" (~6 months stale). DoD #3 ("plugins ROADMAP reconciled with the ecosystem one") requires a rewrite: list the 11 real packages + their M0-M3 alignment status, and either fold the repo under the ecosystem M6 or declare its own scope explicitly.

Gateways has no own ROADMAP (nothing to reconcile) — its CHANGELOG documents the `monorepo-cohesion-split` extraction from theokit-sdk (2026-06-18).

## Finding 4 — DoD #2 (coordinated npm release) is BLOCKED on ecosystem npm-publish infra

**npm `@theokit/sdk` dist-tags: `latest: 2.15.2`, `next: 1.6.2`.** The SDK 2.16.0 (M1), 2.17.0 (M2), and 2.18.0 (M3+M4) were tagged + GitHub-released but **never npm-published** — the `release.yml` CI `changeset publish` step did not run (or is gated/failing). So:

- Gateways/plugins consume `@theokit/sdk` as a **published npm dep**. To build against 2.18.0's M0-M3 Harness they need 2.18.0 on npm — but npm has 2.15.2.
- **Mitigation for build validation:** workspace-link (or `file:`-link) the local SDK 2.18.0 into each cluster for build/test evidence (matches how the SDK's own examples link `file:../../packages/sdk`).
- **DoD #2 proper** ("coordinated Changesets release across sdk + gateways + plugins") cannot complete until the SDK is actually npm-published. This is a **pre-existing systemic ecosystem gap** (3 SDK versions unpublished), not M6 code — it needs the operator's decision on the npm-publish pipeline (NPM_TOKEN / CI trigger). Surface it, do not paper over.

## Coverage Corner 1 — Integration tests

- Gateways: 51 test files across 11 pkgs (vitest v4). Build against workspace-linked SDK 2.18.0 → `pnpm build && pnpm test` per cluster = DoD #1 evidence.
- Plugins: 66 test files across 11 pkgs. Same validation; plus the 3 auth packages' tests exercise the `server/auth` surface.

## Coverage Corner 2 — Dependencies

- Gateways pin `@theokit/sdk ^1.9.0` (peer+dev) across 11 pkgs → bump to `^2.18.0` (or `>=2.18.0`).
- Plugins pin `>=1.0.0`/`>=1.6.0`/`^1.6.0`/`>=1.7.0` + `@next` devDep across ~6 pkgs → bump to `^2.18.0`.
- Phantom `@theokit/plugin-rate-limit` → remove.
- Both repos: pnpm workspace + Changesets 2.31 + Biome + vitest + tsup (toolchain matches the SDK's locked stack — no drift there).

## Coverage Corner 3 — Tools

- SDK surface consumed: `Security.redact` (gateways), `AuthProvider`/`AuthResult`/`OAuthTransaction` from `@theokit/sdk/server/auth` (plugins). Both stable + shipped in 2.18.0.

## Coverage Corner 4 — Techniques

- Workspace-link the local SDK build for cross-repo validation before npm publish exists.
- Changesets per-repo (independent versioning) — a "coordinated release" = aligned changesets in all three, released in dependency order (sdk → gateways+plugins).
- `no-stubs-no-mocks-no-wired` checklist run per cluster.

## ADRs

### ADR-1 — Bump pins to `^2.18.0`, validate via workspace-link (npm publish is a separate infra step)
The consumed surface is stable, so `^2.18.0` builds against the local 2.18.0 build. Validate with a workspace/`file:` link (the SDK's own examples do this) since npm lags at 2.15.2. The npm publish of 2.18.0 is an ecosystem-infra prerequisite for DoD #2, surfaced to the operator — not silently assumed. **Rejected:** pinning to the npm-published `^2.15.0` — it lacks M3/M4, so it would not be "aligned to the M0-M3 Harness" (M3 shipped in 2.18.0).

### ADR-2 — Remove the phantom `@theokit/plugin-rate-limit` peer dep (YAGNI)
No implementation exists; the config is type-only opt-in. Removing the peer dep makes the surface honest (no-stubs-no-mocks-no-wired §3) without inventing a package. **Rejected:** creating `plugin-rate-limit` — out of M6 consolidation scope + YAGNI (no consumer demand recorded).

## Honest scope note

The CODE alignment (pin bumps + phantom-dep removal + ROADMAP rewrite) is tractable and build/test-validatable via workspace-link. But M6 is **22 packages across 2 repos** + a **cross-repo release-train coordination** whose DoD #2 is **blocked on the ecosystem npm-publish pipeline** (SDK 2.16/2.17/2.18 are unpublished — a systemic gap beyond M6 code). A faithful M6 to READY_TO_MERGE requires: (a) per-cluster align+build+test (large but mechanical), (b) the operator resolving the SDK npm-publish so the coordinated release can actually publish. Executed with adequate budget, no workarounds — the npm-publish blocker is a real infra decision, not something to fake.

## Related
- `no-stubs-no-mocks-no-wired.md` — DoD #1 checklist.
- `real-llm-validation.md` — n/a (gateways/plugins are transport/extension layers; no LLM path in scope).
- Ecosystem ROADMAP M6 (`theokit-tools/ROADMAP.md`): DoD #1 build-no-dead, #2 coordinated release, #3 plugins ROADMAP reconciled. Deps M0-M3 (released, tagged; npm-publish pending).
