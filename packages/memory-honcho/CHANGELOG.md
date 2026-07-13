# Changelog

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

- Initial release. Implements `MemoryAdapter` (ADR D141) over `@honcho-ai/sdk@^2.1`.
- `honchoMemory(options)` factory.
- `write` → `session.addMessages([peer.message(text)])`.
- `recall` → `peer.chat(query, { session })` → ONE synthesized fact (EC-J).
- EC-D: session keys namespaced under userId to prevent cross-user leak.
- EC-B: `MemoryId` prefix validation in `delete`.
- AGPL-3.0 self-host disclosure in README.
