# Changelog

## 2.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.3.0
  - @theokit/gateway@2.0.0

## 1.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.2.0
  - @theokit/gateway@1.0.0

## [Unreleased]

### Added — `@theokit/gateway-matrix@0.1.0` (ADRs D413-D421)

- Initial release of the Matrix protocol adapter for `@theokit/gateway`.
- `matrix-js-sdk@^32.0.0` peer-dep (lazy import — full SDK is ~2MB).
- `MatrixAdapter` extending `BasePlatformAdapter`:
  - `connect()` initializes `MatrixClient` with `homeserverUrl + accessToken + userId`; starts sync loop with `initialSyncLimit: 10` (D414, D415).
  - `disconnect()` stops client gracefully; idempotent.
  - `sendMessage()` posts via `client.sendTextMessage(roomId, text)`; reply to alias resolves to room id via `getRoomIdForAlias` (D419).
  - `onInbound()` replace semantics (EC-H).
- Sync loop wrapper (`sync.ts`) filters out:
  - Non-`m.room.message` events (D413).
  - Bot's own messages (loop guard).
  - **EC-3 absorbed**: events older than 60s (initial sync flood prevention — a bot in 50 rooms × 10 events = 500 LLM calls on boot).
- Room state (`room-state.ts`):
  - DM detection (D416): `room.getJoinedMemberCount() === 2` → `channel.type: "dm"`; else `"group"`.
- Alias resolution (D419): caller passes `#general:matrix.org` OR `!abc123:matrix.org`; adapter resolves alias → room id on first use, caches.
- E2EE rooms refused with warn stderr (D418) — v0.1 only operates on unencrypted rooms.
- Federation transparent (D420) — Matrix SDK handles cross-homeserver routing.
- Matrix events preserved in `event.matrix.raw` (D421) for caller access to redactions, relations, etc.
- Threads (MSC4140) deferred to v0.2 (D417).
- E2EE (Olm/Megolm) deferred to v0.2 (D418).
