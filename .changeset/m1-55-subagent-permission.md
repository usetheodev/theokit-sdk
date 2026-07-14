---
"@theokit/sdk": patch
---

Security (#55) — a delegated subagent now inherits the parent's code-registered plugins (e.g. `PermissionPlugin`), so its inner tool calls run under the SAME argument-level permission gate. Previously the child `Agent.create` received only apiKey/model/tools, so a parent that denied `shell` with a matching-arg rule did not stop a subagent it granted `shell` to — arg-level gating silently stopped at the delegation boundary.
