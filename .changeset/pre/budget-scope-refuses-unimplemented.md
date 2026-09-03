---
"@theokit/sdk": patch
---

`Budget.create` now refuses `scope: "agent"` and `scope: "call"` with a
`ConfigurationError` (`unimplemented_budget_scope`).

Only `"process"` was ever implemented. Nothing outside the registry read `scope`,
so the other two were accepted and silently ignored: a caller asking for
per-agent accounting got process-wide accounting with no signal. A cost control
that reports the wrong number is worse than a missing feature.

`FnStep.compensate` is marked deprecated. It was never implemented — setting it
arms `WorkflowCompensateNotImplementedError`, so the step fails at run time.

`AgentLoopInputs` declares `maxConsecutiveToolErrors` and `maxConcurrentTools`,
which were read through inline casts and appeared in no type. A typo in either
name now fails to compile instead of silently taking the default.
