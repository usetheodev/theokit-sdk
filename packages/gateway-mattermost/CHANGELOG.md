# Changelog

## [Unreleased]

### Added — `@usetheo/gateway-mattermost@0.1.0` (ADRs D397-D404)

- Initial release of the Mattermost platform adapter for `@usetheo/gateway`.
- `@mattermost/client@^9.0.0` peer-dep (modern v4 REST + WebSocket gateway).
- `MattermostAdapter` extending `BasePlatformAdapter`:
  - `connect()` initializes Client4 + WebSocketClient; caches bot userId via `getMe()`.
  - `disconnect()` closes WebSocket; idempotent.
  - `sendMessage()` posts to channel; thread replies set `root_id` from `topicId`.
  - `onInbound()` subscribes to WS `posted` events; single-handler replace semantics (EC-H).
- Inbound dispatch pipeline (D403, EC-2):
  1. Drop bot's own posts (loop guard, D275 mirror).
  2. DMs always dispatch.
  3. Channels: respond only when mentioned. **Metadata.mentions array checked FIRST** (unambiguous user-id list from API) before falling back to text-regex with **word-boundary** (`\b@${botUsername}\b` — prevents `@theory` matching `@theo`).
- Channel-type mapping (D402): `D` → `dm`, `G`/`O`/`P` → `group`. Original Mattermost type preserved in `event.mattermost.channelType`.
- Personal Access Token auth (D401). OAuth deferred to v0.2.
- File uploads (D404), Slash commands, and ephemeral messages deferred to v0.2 — caller can access `adapter.getClient()` (REST) for escape-hatch use.
