---
"@theokit/sdk": patch
---

The undeclared-`.claude/` warning now reaches the consumer

`5.0.0` made a project's `.claude/` opt-in, and its release note said the workspace "says so once,
on the diagnostics channel". It did not say so to anyone.

The warning went through `diag()`, which returns without doing anything when no diagnostics sink is
installed. The SDK installs none, and neither of the two observable hosts does either. So a
consumer upgrading `4.63.4` → `5.0.0` with a `.claude/` and no `compatSources` lost hooks, skills,
subagents and plugins **in silence** — along with the one line that reverses it:

```ts
local: { compatSources: ["claude-code"] }
```

It now goes through `diagFailure()`, which prefers an installed sink and falls back to stderr when
there is none. A host that intercepts diagnostics keeps owning its render surface; a host that does
not, still hears this one.

The cost is real and is now paid: a repository that wants `.claude/` ignored sees a line. It is
emitted once per directory per process, not per turn — and before `5.0.0` that repository was
having the directory imported anyway, so the line confirms the fix it wanted. There is no opt-out
yet; if the noise matters, say so. (#563)
