# D303 — `ConversationStorageAdapter` exported from main barrel (not sub-export)

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 1, T1.1

## Decision

`ConversationStorageAdapter` interface + `FileSystemConversationStorage` + `InMemoryConversationStorage` are exported from the main `@theokit/sdk` barrel, NOT from a sub-export like `@theokit/sdk/conversation`.

## Rationale

The contract is central to any serious consumer (TheoKit, future frameworks). Sub-exports break discoverability — devs need to know the sub-export name to import. Main barrel is the expected entry point with autocomplete coverage.

Existing SDK sub-export precedent (D24 Zod, D43 LanceDB, `/tools`, `/path-safety`) follows the rule: sub-export when the feature is optional + peer dep carries material payload. Pure type interfaces + zero-dep classes don't justify a sub-export.

## Alternatives considered

- **Sub-export `@theokit/sdk/conversation`** — rejected. Adds import discoverability friction. The interface is 5 methods; type weight is negligible.
- **Separate package `@theokit/conversation-storage`** — rejected. Would require maintaining a separate publish + version dance for what is fundamentally a 30-line interface + 2 thin adapter classes. Not worth the cost.

## Consequences

- Enables natural discovery via autocomplete on `@theokit/sdk` import.
- Future rename of an interface method requires major bump — but the surface is stable (5 methods).
