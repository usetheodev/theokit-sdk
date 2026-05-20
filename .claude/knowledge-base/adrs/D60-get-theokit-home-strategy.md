# ADR D60 — `getTheokitHome(cwd)` is the canonical path resolver

Date: 2026-05-18
Status: Accepted
Plan: [persistence-state-hardening](../plans/persistence-state-hardening-plan.md)

## Decision

Single resolver function: `getTheokitHome(cwd: string): string`. Logic:

- If `process.env.THEOKIT_HOME` is set and non-empty (after trim), return that.
- Otherwise return `path.join(cwd, ".theokit")`.

Profile root (`getProfilesRoot()`) is always anchored to `~/.theokit/profiles/`
regardless of `THEOKIT_HOME` so profile discovery is independent of which
profile is currently active.

## Rationale

- Theokit anchors state at `<cwd>/.theokit/` by default. Changing that
  break-changes too many existing callers; we keep cwd-anchored as the
  default.
- Adding `THEOKIT_HOME` env override solves the load-bearing test isolation
  problem (vitest `setupFiles` swaps it to a tmpdir) AND opens the door
  to profile/multi-tenant deployments WITHOUT a breaking change.
- Mirrors Hermes `_apply_profile_override()` + `get_hermes_home()` discipline
  (`hermes_constants.py`) but adapted to Theokit's per-cwd model.

## Alternatives considered

- **Home-anchored like Hermes**: `~/.theokit/profiles/<name>/` default. Rejected
  because it would break every existing caller that does
  `join(cwd, ".theokit", ...)`.
- **CLI flag only**: would not solve test isolation (tests don't go through
  the CLI).

## Consequences

- Callers that currently hardcode `join(cwd, ".theokit", ...)` will gradually
  migrate to `getTheokitHome(cwd)`. A lint test
  (`tests/lint/no-hardcoded-theokit-path.test.ts`) caps the regression count
  and acts as migration tracker.
- The `vitest.setup.ts` autouse `beforeEach` sets `THEOKIT_HOME` to a fresh
  tmpdir, so all tests are hermetically isolated from the developer's real
  state.
- Tests can still opt-out by overwriting `process.env.THEOKIT_HOME` inside
  the test body; the autouse `afterEach` cleanup honors the original env value.
