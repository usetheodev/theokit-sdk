---
"@theokit/sdk": patch
---

The MCP OAuth token store now resolves its path when an operation runs — reading the same environment variable `os.homedir()` reads on that platform (`USERPROFILE` on Windows, `HOME` elsewhere), with `os.homedir()` itself as the fallback — instead of binding a path once when the module is first imported.

`internal/mcp/token-storage.ts` held `const FILE_PATH = join(homedir(), ".theokit", "mcp-tokens.json")` at module scope. A constant at module scope captures ambient global state at import, so the store kept reading and writing under whichever `HOME` was set at that moment and never noticed a later change. It made the module's correctness a property of *when* it was imported, which is not a property a credential store should have.

Reading the environment first is not a stylistic preference, and **the variable read is per platform because `os.homedir()` itself is**: on POSIX it prefers `$HOME`, on Windows it reads `USERPROFILE` and never consults `HOME`. Mirroring that split keeps this a binding-time fix rather than a behaviour change. In a normal process on either platform the resolved path is identical to what shipped before.

They diverge in exactly one place — inside a worker thread, `process.env` is a JS-level copy while `os.homedir()` is a native call reading the real process environment, so a home moved inside a worker is invisible to `homedir()`.

An empty or whitespace-only value falls through to `homedir()`. Being precise about what that buys, because an earlier draft of this note overstated it: on POSIX it is close to a no-op, since `homedir()` returns the same empty value, and an empty home resolves the store to a CWD-relative `.theokit/mcp-tokens.json` either way. It earns its place on Windows and for a worker whose environment copy was blanked.

**Windows is untested.** Every test covering this file is skipped off POSIX and CI runs ubuntu only. The platform split is reasoned from `os.homedir()`'s documented per-platform source, not from a run on Windows. The branch selection itself IS tested, by spying `process.platform`.

The path is resolved once per operation and passed down, including into the directory-permission step. Resolving it per use would let a read and the write that follows it disagree if `HOME` moved in between, or lock down one directory while the token lands in another.

**Behaviour change, both directions.** A process that moves `HOME` after importing the SDK now has its tokens follow the new home. On the write path that is the safer reading — the alternative writes credentials to a location the caller no longer considers theirs. On the read path it has a cost worth naming: tokens stored under the previous home are no longer found, so `getTokens` returns `undefined` and the caller sees "not logged in" rather than an error. Following the current home is still the right trade for a credential store, but it converts a stale-write risk into a silent-re-auth one, and both sides are stated here rather than only the favourable one.

`THEOKIT_HOME` is deliberately not honoured by this store. `transcriptRoot()` does honour it and M94 ADR-2 accepted that migration for the sibling module; doing the same for credentials changes what existing token holders see, which is a product decision rather than a prerequisite for making this module independent of the execution model.

Found while measuring whether mutation testing is viable on this package: the directory-permission tests passed only because `vitest.config.ts` pins the `forks` pool with `fileParallelism: false`. A tool that controls test execution refused to start against that baseline. The suite now carries a regression test that holds under the default config **and** under `--pool=threads`.
