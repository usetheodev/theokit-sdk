---
"@theokit/sdk": patch
---

The MCP OAuth token store now resolves its path when an operation runs, instead of binding it once when the module is first imported.

`internal/mcp/token-storage.ts` held `const FILE_PATH = join(homedir(), ".theokit", "mcp-tokens.json")` at module scope. A module-level constant captures ambient global state at import, so the store kept reading and writing under whichever `HOME` was set at that moment and never noticed a later change. In a normal process `HOME` does not move, so this was invisible in production — but it made the module's correctness a property of *when* it was imported, which is not a property a credential store should have.

The path is now computed by a private function, called once per operation and held in a local for the duration of that operation. Resolving it per use instead would let a read and the write that follows it disagree if `HOME` moved in between, which is the one way this change could have been worse than the constant it replaces.

**Behaviour change, and the reason it is a `patch`:** a process that changes `HOME` after importing the SDK now has its tokens follow the new home. Previously they stayed under the old one. For a refresh-token store, following the current home is the safer of the two readings — the alternative writes credentials to a location the caller no longer considers theirs.

Found while measuring whether mutation testing is viable on this package: the three directory-permission tests in `tests/mcp-token-store-modes.test.ts` passed only because `vitest.config.ts` forces `fileParallelism: false`, giving every file a fresh module registry. Under a shared registry they failed, and a tool that controls test execution refused to start against that baseline. The suite now carries a regression test that fails under the **default** configuration, so the gate can observe both the defect and its fix.
