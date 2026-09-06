---
"@theokit/sdk": patch
---

`effectiveToolNames` refuses a created tool instead of answering confidently about it (#583 follow-up)

Every field on `AgentOptions` is optional, so the `CustomTool` that `SubAgent.create()` returns —
`{ name, description, inputSchema, handler }` — satisfies the type **by vacuity, with no cast**.
Measured: a `@ts-expect-error` on that call is reported unused (`TS2578`), so the compiler genuinely
does not refuse it.

What came back was worse than a wrong number:

```ts
effectiveToolNames(SubAgent.create({ name: "analyst", … }))
// { names: ["shell"], unresolved: [] }
```

The empty `unresolved` claims **completeness** about an object the function never understood. A
caller reads that as *"this subagent still announces a shell"* and either disbelieves a fix that
worked, or "fixes" something on the strength of it. That is the defect #583 exists to eliminate, one
function further on — and the same argument that made this return `{ names, unresolved }` rather than
a bare array forbids it.

It now throws a `ConfigurationError` naming what to pass instead. The detection is exact rather than
heuristic: `AgentOptions` declares neither `handler` nor `inputSchema`, so an object carrying **both**
is a tool and not options.

**The workaround is still needed, and the 5.2.0 notes should not have implied otherwise.**
`SubAgent.create()` closes its spec inside the handler, so the spec cannot be recovered from the
returned tool — keep it in a variable, or extract it into a function a test can call, and pass that.

Reported by the `theocode` session, against advice of mine that was wrong.
