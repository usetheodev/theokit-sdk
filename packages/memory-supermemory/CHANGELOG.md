# Changelog

## 0.1.0

### Added
- Initial release. Implements the `MemoryAdapter` contract (ADR D141) over
  the `supermemory@^4.21.0` SDK. Exposes:
  - `supermemoryMemory(options)` plugin factory.
  - `MemoryAdapter.write` → `documents.add` with translated containerTags.
  - `MemoryAdapter.recall` → `search.memories` with rerank=true.
  - `MemoryAdapter.delete` → `documents.delete` with EC-B prefix validation.
  - LLM-callable tool schemas (`memory_write`, `memory_recall`).
- EC-C identifier sanitizer (`^[a-zA-Z0-9_-]+$`) for every containerTag
  component — prevents silent cross-bucket leak from `:`/whitespace in
  userId/agentId/tenantId/tags.
- Typed error translation: 401/403 → `auth_failed`, 429 → `rate_limited`,
  404 → `not_found`, network → `network`.
