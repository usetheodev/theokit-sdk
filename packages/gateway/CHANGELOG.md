# Changelog

## [0.4.0] - 2026-05-24

### Added
- `EmailMessageEvent` variant added to the `MessageEvent` discriminated union (ADR D339). Required for `@usetheo/gateway-email`.
- `PlatformName` union opened to include `"email"`.

### Changed
- Minor version bump (additive change — existing adapters / consumers unaffected).

## [0.3.0] - 2026-05-23

### Added
- `TeamsMessageEvent` variant added to the `MessageEvent` discriminated union (ADR D325). Required for `@usetheo/gateway-teams`.
- `PlatformName` union opened to include `"teams"`.

### Changed
- Minor version bump (additive change — existing adapters / consumers unaffected).

## [0.2.0] - 2026-05-23

### Added
- `WhatsAppMessageEvent` variant added to the `MessageEvent` discriminated union (ADR D308). Required for `@usetheo/gateway-whatsapp`.
- `PlatformName` union opened to include `"whatsapp"`.

### Changed
- Minor version bump (additive change — existing adapters / consumers unaffected).

## [0.1.0] — 2026-05-20

### Added

- Initial release. Core gateway primitives for `@usetheo/sdk`.
- `BasePlatformAdapter` abstract class — contract for transport adapters (ADR D172).
- `MessageEvent` discriminated union with `platform` discriminator (ADR D173).
- `GatewayRunner` — top-level orchestrator with drain timeout on `stop()` (EC-E).
- `SessionRouter` — pure routing strategy; composes `Agent.resume` (ADR D174).
- `DeliveryRouter` — outbound dispatch; composes `Cron` (ADR D175).
- `HookExecutor` with `pre_inbound` / `post_outbound` / `on_error` (ADRs D176, D177).
- `ctx.reply` auto-routes to the adapter matching `event.platform` (EC-G).
- `{ block: true, message }` from `pre_inbound` triggers auto-reply before short-circuit (EC-D).
- All runner error log paths wrap text in `Security.redact(...)` from `@usetheo/sdk` (EC-F, ADR D68).
