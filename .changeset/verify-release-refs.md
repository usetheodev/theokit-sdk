---
"@theokit/sdk": patch
---

`pnpm release` now verifies its tags reached the remote instead of trusting an exit code.

`changeset publish` creates one annotated tag per published package and pushes them, then reports
success on its own exit code — and an exit code is not evidence a ref transferred.

Measured 2026-08-11: `git push` contacts the remote BEFORE `pre-push` runs, `pre-push` runs the full
`pnpm validate` for around eleven minutes, and by the time the transfer begins the server has
dropped the idle connection. Git dies of SIGPIPE (exit 141) silently — no error text, nothing
transferred, output ending in `✓ pre-push gates passed`. A missing release tag is not noticed that
day; it is noticed weeks later by whoever is bisecting.

`scripts/verify-release-refs.mjs` compares the tags at a revision against `git ls-remote`, and is
wired into `pnpm release` after `changeset publish` rather than offered as a wrapper — a wrapper
only helps whoever remembers to call it.

Three distinct exit codes, because collapsing them is the failure being removed: `0` verified,
`1` a tag never reached the remote, `2` could not check (unreachable remote, or a revision that does
not resolve).
