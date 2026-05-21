# Changelog

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
