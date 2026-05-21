# D172 — `BasePlatformAdapter` is an abstract class, not an interface

**Date:** 2026-05-21
**Status:** Accepted

## Decision

`BasePlatformAdapter` uses TypeScript's `abstract class` with concrete shared methods (e.g., `startTyping`, `stopTyping` defaults) and abstract hooks subclasses must implement (`connect`, `disconnect`, `sendMessage`, `onInbound`).

## Rationale

Adapters share ~30-40% of lifecycle code (typing-indicator defaults, event normalization patterns, the "never throw on platform errors" rule). Interface-only would force every adapter to copy that. Hermes' Python `BasePlatformAdapter` follows the same pattern for the same reason. The "favor composition" maxim doesn't apply when the shared code is **adapter lifecycle**, not domain logic — there's no third axis of variation to compose with.

## Consequences

- **Enables:** new adapters in ≤200 LoC by overriding 3-4 abstract methods.
- **Constrains:** every adapter is a subclass — tighter coupling than pure interface. LSP holds: subclasses must not strengthen pre-conditions or weaken post-conditions of the base.
