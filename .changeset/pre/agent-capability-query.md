---
"@theokit/sdk": minor
---

`Agent` can now be asked which operations it supports, instead of being told by an exception.

`SDKAgent` is one handle over two runtimes that do not offer the same operations, and the type did
not model the difference. `downloadArtifact` is a **required** member that rejects for every input on
a local agent; `listArtifacts` is required and returns `[]` for every state, so "no artifacts" and
"this runtime has no artifacts" were the same value. On a cloud agent, five members declared
_optional_ are present-but-throwing — so `typeof agent.fork === "function"` is `true` and calling it
throws. Neither requiredness nor optionality expresses "exists here, not there", which left a caller
no way to branch except a `try`/`catch` around a call it did not want to make.

Two additive members answer the question first, mirroring `Run.supports(op)` /
`Run.unsupportedReason(op)`, which already solved this one layer down:

```ts
if (agent.supports("downloadArtifact")) {
  await agent.downloadArtifact(id);
} else {
  logger.info(agent.unsupportedReason("downloadArtifact"));
}
```

The new `AgentOperation` union is exported. Nothing was removed and no signature changed, so a
caller that never asks behaves exactly as before.

This is a mitigation. The structural fix is to split `SDKAgent` into a common core plus
`LocalCapableAgent` / `CloudCapableAgent`, so the compiler refuses the call rather than the runtime.
That is breaking on a published 4.x surface and is deliberately not done here.
