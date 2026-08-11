---
"@theokit/sdk": minor
---

`resolveTrustPosture` — decide what a project directory is allowed to switch on.

A product that reads a repository must answer this before it builds anything: are that repository's
hooks honoured, are its MCP servers started, do its instructions enter the persona? The stakes are
not configuration-shaped — a hook is arbitrary command execution on every tool call, and an MCP
server is an external process SPAWNED while the agent is built, before any per-tool approval exists
to refuse it.

The arithmetic is small; the invariant is the point. Untrusted means EVERY declared capability is
off, and `allows` is built FROM the declared list, so a product that adds a ninth capability cannot
forget to gate it. That failure is invisible when it happens: the new capability simply works in a
directory where it should not.

It deliberately does NOT decide what "trusted" means. Where the record lives, what the environment
variable is called, whether a legacy alias is honoured — all the consumer's, because all of it is
that product's vocabulary. `source` is reported (`env` / `store` / `default`) because "trusted
because the operator recorded this directory" and "trusted because a blanket switch is on" are
different facts, and only the second stays on across every directory the process opens.

Additive. Nothing calls it yet.
