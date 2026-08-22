---
"@theokit/sdk-handoff": patch
---

`HandoffOptions.tools` now restricts the receiving agent, as its name always implied.

Nothing in the package read it. A caller passing `{ tools: ["read_file"] }` — the option was
presented as an allowlist — got no restriction and no warning, which is worse than an absent option
because it gives false assurance. It is wired to `SendOptions.activeTools`, the same
`withToolWhitelist` path `Agent.fork`'s `allowedTools` uses: exact name matching, an empty list
means the empty set (fail-closed), and omitting the option imposes no restriction.

Local runtime only — a cloud agent ignores `activeTools`, and the docblock now says so.
