# Changelog

## 3.0.1

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

## 3.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@4.0.0

## 2.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@3.0.0

## 1.0.0

### Patch Changes

- Updated dependencies [b9f30a6]
  - @theokit/sdk@2.0.0

## 2.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.3.0

## 1.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.2.0

## 0.1.0

### Added

- Initial release. Implements `MemoryAdapter` (ADR D141) over `mem0ai` `MemoryClient` cloud (D148 — OSS local mode NOT supported).
- `mem0Memory(options)` factory.
- Unique `history(id)` capability — version tracking per memory.
- Circuit breaker (EC-K): 5 consecutive 5xx trip; 429 does NOT count.
- EC-B: `MemoryId` prefix validation in `delete` + `history`.
- CVSS 8.1 (CVE-2026-XXXX) OSS-backend security disclosure in README.
