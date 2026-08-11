# Changelog

## 0.1.2

### Patch Changes

- 8790f70: Refuse a `workspace:` range before it can reach npm.

  Five of this repo's twelve publishable packages declare internal dependencies as `workspace:^`, which
  is correct on disk and becomes an unrecoverable defect if the publish goes out through a tool that
  does not rewrite it: `pnpm` resolves the protocol while packing, `npm` ships the manifest verbatim.
  A version published that way fails to install for everyone and cannot be corrected — only
  deprecated.

  Every publishable package now runs the guard in `prepublishOnly`, so it fires whichever way the
  publish is invoked, and `pnpm release` runs it once across the repo before `changeset publish`.

  Note for anyone reading a published manifest: the `prepublishOnly` entry points at a path inside
  this repository. It never runs for a consumer — the hook only fires when the package itself is
  published — and guarding the entry point that a hand-run `npm publish` actually uses was worth the
  cosmetic wart of shipping the line.

## 0.1.1

### Patch Changes

- 453ad2d: SE43 — system-design audit fixes (public-surface changes).

  - **`@theokit/sdk` (minor):** the shared persistence kernel is now reachable from the sanctioned public `@theokit/sdk/persistence` barrel — `withCwdMutex`, `sanitizeFts5Query`, and `PersistenceSchema` are added (joining `replaceFileAtomic` / `openSqliteResilient` / `atomicWriteText` / `atomicWriteJson`). The `@theokit/sdk/internal/persistence` export is now **deprecated**: it re-exports its full surface unchanged for one release (back-compat) and is scheduled for removal in a future major. No breaking change; existing imports keep working.
  - **Satellites (patch):** `sdk-tools` / `sdk-memory` / `sdk-cache` / `sdk-handoff` / `sdk-budget` tightened their `@theokit/sdk` peer-range floor from `>=1.7.0` to `>=4.0.0`, matching the v4-only surfaces they import (prevents a non-workspace install resolving an incompatible old sdk).

All notable changes to `@theokit/sdk-handoff` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

(No unreleased changes.)

## [0.1.0] — 2026-06-08

### Added

- Initial extraction from `@theokit/sdk@1.7.0` `src/handoff.ts` + `internal/handoff/` + `types/handoff.ts`.
- Public API: `Handoff.create(target, opts?)`, `Handoff.asPlugin({ targets, maxHandoffDepth? })`, `handoffTo(agent, opts?)`.
- Errors (loop protection): `HandoffLoopError`, `HandoffPairLoopError`, `HandoffSelfReferenceError`, `HandoffReceiverDisposedError`, `HandoffNameCollisionError`.
- Sub-path `@theokit/sdk-handoff/internal/tool-injector` — used by `@theokit/sdk` to lazy-load the dispatcher when consumers use the transitional `Agent.create({ handoffs: [...] })` option.
- Peer-deps: `@theokit/sdk@>=1.7.0`, `zod@^3.25.0 || ^4.0.0`.

### Notes

- The `Handoff.asPlugin()` factory is the **preferred** API in 2.x. The legacy `Agent.create({ handoffs: [...] })` option still works while `@theokit/sdk-handoff` is installed (optional peer model), but the codemod marks every call site with a `CODEMOD` comment. Plan removes the option in the 2.0.0 cohort bump.
- Inline `to-json-schema.ts`: sdk-handoff/src/internal/to-json-schema.ts is a 126-LOC duplicate of `@theokit/sdk` `internal/zod/to-json-schema.ts`. Reason: rollup-plugin-dts emits incomplete declaration files for newly-added internal/ barrels in `@theokit/sdk` (consistent bug — affected observability, security; would affect zod too). Inlining sidesteps the bug AND keeps sdk-handoff self-contained.
