---
"@theokit/sdk-handoff": patch
---

`Handoff.asPlugin(...).register()` now returns a promise that settles once the transfer tools are
registered.

It used to start an unawaited async IIFE and return, so the tools appeared a module-load later —
whether they existed for the first `send()` depended on timing no caller controlled — and
`HandoffSelfReferenceError` / `HandoffNameCollisionError` became unhandled rejections that could not
be caught around `Agent.create`, leaving an agent silently without handoff tools. The plugin
contract already typed `register` as returning `void | Promise<void>` and the manager already
awaited it. The import stays lazy.
