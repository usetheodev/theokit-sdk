---
"@theokit/sdk": minor
---

**SE18 — `SendOptions.activeTools` (per-send runtime tool subset).**

`agent.send(input, { activeTools })` restricts, per send, which of the agent's registered tools the model may actually call. A tool whose canonical name is not in the list is vetoed at dispatch (its handler never runs) — reusing the existing `withToolWhitelist` path that `Agent.fork`'s `allowedTools` uses, NOT `PermissionEngine`. Composes with `toolChoice`: `activeTools` narrows the set, `toolChoice` gates calling within it. Absent ⇒ the full toolset is available (unchanged).

The loop runs inside a `withToolWhitelist(new Set(activeTools))` scope when set. Additive + backward-compatible. Mirrors Mastra `activeTools` + the Vercel AI SDK. From the Mastra Tools comparison (SDK Evolution roadmap SE18).
