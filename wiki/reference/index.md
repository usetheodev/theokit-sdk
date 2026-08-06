# Reference

The two consumer-facing reference documents. These ship inside the npm tarball, so a
consumer reads them offline at `node_modules/@theokit/sdk/docs/`, pinned to the exact
version installed.

**This folder is gate-scoped.** `packages/sdk/tests/lint/shipped-docs.test.ts` asserts that
every `.md` here other than this index appears on the copy list in
`packages/sdk/scripts/copy-docs.mjs`. A new reference document lands here only together with
its ship-list entry; everything else in the wiki belongs in another folder.

* [Harness capability map](harness-capability-map.md) - Every public primitive with its real import path and a minimal example.
* [Error codes](error-codes.md) - The `AgentRunError.code` union and the provider-to-code mapping.
