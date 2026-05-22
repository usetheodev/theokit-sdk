# Changelog

## [Unreleased]

### Added
- `SlackAdapter` implementing `BasePlatformAdapter` (Roadmap #7; ADRs D267-D285).
- Socket Mode transport via `@slack/bolt` (D267, D268).
- `SlackMessageEvent` variant added to gateway `MessageEvent` union (D274).
- `splitForSlack` 4000-char + surrogate-pair guard (D272).
- `mapSlackError` SlackApiError → canonical SendResult codes (D273).
- `requireMention: true` default for channels to prevent cost explosion (D285).
- Bot loop guard via cached `botUserId` (D275, D277).
