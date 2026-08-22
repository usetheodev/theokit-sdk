---
"@theokit/sdk": minor
---

Fix three unresolved type references in the published declaration file (#335).

`MemoryProviderFactory` is now exported from the package root. It is the shape a
consumer must satisfy to write a memory plugin — the public `Plugin` union names
it in the `createProvider` position — but it carried the internal-visibility
JSDoc tag, so `stripInternal` deleted the declaration while the union went on
referencing it. The shipped `.d.ts` named a type it did not declare.

`AgentBuilderDeps` and the blast-radius symbol used as a computed key in
`WithBlastRadius<T>` had the same defect on other surfaces and are now emitted.
Neither is added to the public API — they only needed to exist in the declaration
file that references them.

None of this is visible under `skipLibCheck`, which is why it shipped. Consumers
running type-aware lint saw every type reached through those references degrade
to `error`, producing `no-unsafe-*` reports on correct SDK calls.
