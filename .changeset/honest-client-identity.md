---
"@theokit/sdk": patch
---

The ChatGPT provider identifies itself as `theokit`, not as the official Codex CLI.

The profile shipped `originator: "codex_cli_rs"` — the value the official Codex CLI sends for itself.
Presenting another vendor's client name is a false statement of identity, and it diverged from the
prior art this provider was adapted from: Upstream sends its own name against the same endpoint,
which also shows the route is not restricted to the official client.

A test pinned the old value as the contract, which is how it survived review — correcting the
identity registered as a regression. That assertion now pins the honest value and asserts the false
one is never sent again.

This does not, on its own, resolve the immediate 429 reported in theokit-sdk#165; confirming that
needs a live credential and is tracked on the issue.
