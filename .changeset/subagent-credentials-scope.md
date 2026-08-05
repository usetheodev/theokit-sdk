---
"@theokit/sdk": patch
---

Subagent credential inheritance no longer rides a property on the tool object (theokit#148).

A delegated child inherited its parent's API key through a symbol-keyed slot installed on the
subagent tool. That contract assumed the object would reach the dispatcher with an extra property
intact — and it broke twice: once because the bundler inlined two copies of the module that
disagreed on the key (#142/#143), and once because any layer rebuilding the tool from its known
fields simply dropped it. `@theokit/agents` hit the second and had to add an explicit symbol-copy
loop to compensate; the SDK's own tool assembly performs the same rebuild.

Credentials now travel on the run's async scope, so they reach the handler no matter what the tool
object looks like by the time it is dispatched. Consumers that normalize, wrap, or re-create SDK
tools no longer need to preserve hidden properties — a delegated child gets the parent's key either
way. The band-aid symbol-copy in `@theokit/agents` becomes unnecessary once the SDK
carrying this change is the resolved version. Against an OLDER SDK the copy loop is still required:
the pre-fix runtime reads the credential sink off the tool object, so a band-aid-free
`@theokit/agents` resolving an SDK below this release reproduces the very credential loss this issue
reports. `@theokit/agents` declares a caret range on `@theokit/sdk`, so that pairing is a normal
install rather than a hypothetical — raise the dependency floor in the same release that removes
the loop.

Also fixes a latent defect the old design could not avoid: credentials were stored per tool
instance, so one subagent tool shared by two concurrently running agents got last-writer-wins. Each
run now reads its own.
