---
"@theokit/sdk": minor
---

**SE22 — dynamic skills resolver (`skills: (ctx) => SkillsSettings`).**

`AgentOptions.skills` now accepts a resolver function in addition to the static `SkillsSettings` object. The resolver receives a per-send context (`agentId`, `cwd`, `model`, `userMessage`, `memory` — mirroring the systemPrompt resolver's context, minus the not-yet-resolved `skills`) and returns the `SkillsSettings` for that run. It is evaluated per `send()` before skill assembly, so a cached `getOrCreate` agent re-resolves each run — pick skills from runtime context (e.g. the user's role).

A static object behaves exactly as today. The agent-scoped `agent.skills` handle reflects the static/base config; the resolver drives the per-send `<skills>` block. The SDK imposes no timeout (wrap your own `Promise.race`); a throwing resolver fails the run — no silent fallback (Rule 8). Cloud agents reject a function resolver (it can't run on PaaS — resolve to a static object first), mirroring the systemPrompt-resolver cloud rule. New public types `SkillsResolver` + `SkillsResolverContext`. Mirrors a peer framework Agent-skills `skills: ({ requestContext }) => SkillInput[]`. From the a peer framework Agent-skills comparison (SDK Evolution roadmap SE22).
