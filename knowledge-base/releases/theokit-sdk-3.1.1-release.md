# Release @theokit/sdk@3.1.1

**Date:** 2026-07-13
**Verdict:** RELEASED
**Bump:** patch (changesets, from consumed `message-bus-timer-leak.md`)
**PR:** https://github.com/usetheodev/theokit-sdk/pull/108
**Merge commit:** 92ffac4cd6b91d6322d8a73da70901861d8fbbca
**Tag:** @theokit/sdk@3.1.1
**GitHub release:** https://github.com/usetheodev/theokit-sdk/releases/tag/@theokit/sdk@3.1.1
**npm:** https://www.npmjs.com/package/@theokit/sdk/v/3.1.1

## Release notes

### Fixed
- a2a: leaked timeout timer in `MessageBus.request` — request raced the handler
  against a `setTimeout` but never cleared the timer when the handler won; a
  successful request left a live 30s timer that kept the Node event loop alive,
  so a process hung after the reply. Cleared in a `finally`. Regression test
  asserts `vi.getTimerCount() === 0` after a settled request.

Downstream: dependent example packages bumped to consume @theokit/sdk@3.1.1.

Note: ad-hoc release (plan has no `milestone_id`) — ROADMAP checkbox flip skipped by design.
