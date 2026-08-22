---
"@theokit/sdk": patch
---

`LocalSandbox` now appends the `...(truncated)` marker when a command's output exceeds
`maxOutputBytes`, as `ExecuteResult` has always documented.

Node caps `execFile`'s buffer AT `maxBuffer`, so for ASCII output the string came back exactly at
the cap — never *greater* — and the length test that gated the marker never fired. Callers were
told to branch on a marker that was never written, and every derived helper (`readFile`, `glob`,
`grep`, `listDir`) returned a silent prefix. Since a cut command reports `exitCode: 1` like any
other failure, the marker is the only thing that distinguishes lost output from a failed command.

`LinuxSandbox` routes through the same `execute` and is fixed with it.
