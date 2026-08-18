---
"@theokit/sdk": patch
---

The MCP OAuth token store now resolves its path when an operation runs, reading `process.env.HOME` with `os.homedir()` as the fallback, instead of binding a path once when the module is first imported.

`internal/mcp/token-storage.ts` held `const FILE_PATH = join(homedir(), ".theokit", "mcp-tokens.json")` at module scope. A constant at module scope captures ambient global state at import, so the store kept reading and writing under whichever `HOME` was set at that moment and never noticed a later change. It made the module's correctness a property of *when* it was imported, which is not a property a credential store should have.

Reading `process.env.HOME` first is not a stylistic preference. On POSIX `os.homedir()` already prefers `$HOME`, so in a normal process the two are byte-identical; on Windows `HOME` is typically unset and the fallback runs, which is also what shipped before. They diverge in exactly one place — inside a worker thread, `process.env` is a JS-level copy while `os.homedir()` is a native call reading the real process environment. An empty `HOME` falls through to `homedir()` rather than resolving the store to `/.theokit`, the same guard `internal/persistence/paths.ts` and `session-transcript.ts` already use.

The path is resolved once per operation and passed down, including into the directory-permission step. Resolving it per use would let a read and the write that follows it disagree if `HOME` moved in between, or lock down one directory while the token lands in another.

**Behaviour change, both directions.** A process that moves `HOME` after importing the SDK now has its tokens follow the new home. On the write path that is the safer reading — the alternative writes credentials to a location the caller no longer considers theirs. On the read path it has a cost worth naming: tokens stored under the previous home are no longer found, so `getTokens` returns `undefined` and the caller sees "not logged in" rather than an error. Following the current home is still the right trade for a credential store, but it converts a stale-write risk into a silent-re-auth one, and both sides are stated here rather than only the favourable one.

`THEOKIT_HOME` is deliberately not honoured by this store. `transcriptRoot()` does honour it and M94 ADR-2 accepted that migration for the sibling module; doing the same for credentials changes what existing token holders see, which is a product decision rather than a prerequisite for making this module independent of the execution model.

Found while measuring whether mutation testing is viable on this package: the directory-permission tests passed only because `vitest.config.ts` pins the `forks` pool with `fileParallelism: false`. A tool that controls test execution refused to start against that baseline. The suite now carries a regression test that holds under the default config **and** under `--pool=threads`.
