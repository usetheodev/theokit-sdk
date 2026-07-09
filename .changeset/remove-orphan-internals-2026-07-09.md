---
"@theokit/sdk": patch
---

Remove 3 orphaned internal helpers (dead code, 0 references monorepo-wide): `buildRequestId` (a wrapper around `generateRequestId`, no callers), `isCloudAgentId` (`internal/ids.ts`, no callers), and `deleteTokens` (`internal/mcp/token-storage.ts`, no callers). All `@internal`, not part of the public API. Verified: typecheck + build green, full test suite unchanged (181 pre-existing flaky failures, 3042 pass — identical to baseline).

The remaining knip-flagged "unused exports" were audited and deliberately NOT deleted: they are mostly redundant `export` modifiers on symbols still used same-file (cosmetic), future-reserved stubs (`serializeHookRules` — "reserved for future"), or intentional test/reset seams (`__*ForTests`, `createTestCtx`, `clearRunRegistry`, `memoryFilePath` — "kept for tests"). Those are maintainer judgment calls, not mechanical dead code. See `DEAD-CODE-REVIEW-2026-07-09.md`.
