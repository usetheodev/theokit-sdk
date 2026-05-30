# Changelog

## 2.0.0

### Patch Changes

- Updated dependencies
  - @usetheo/sdk@1.3.0

## 1.0.0

### Patch Changes

- Updated dependencies
  - @usetheo/sdk@1.2.0

## 0.1.0

### Added

- Initial release. Implements `MemoryAdapter` (ADR D141) over `mem0ai` `MemoryClient` cloud (D148 — OSS local mode NOT supported).
- `mem0Memory(options)` factory.
- Unique `history(id)` capability — version tracking per memory.
- Circuit breaker (EC-K): 5 consecutive 5xx trip; 429 does NOT count.
- EC-B: `MemoryId` prefix validation in `delete` + `history`.
- CVSS 8.1 (CVE-2026-XXXX) OSS-backend security disclosure in README.
