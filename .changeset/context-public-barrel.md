---
"@theokit/sdk": minor
---

Add `@theokit/sdk/context` — a sanctioned public barrel for context assembly.

Discovery, rule activation and `@path` import resolution were implemented inside
`internal/runtime/context/` and reachable by nobody: 31 subpaths were declared, none covered the
tree, and every deep import answered `ERR_PACKAGE_PATH_NOT_EXPORTED`. A consumer that wanted the
capability had to re-derive it — measured at ~430 LoC in one downstream product.

The barrel is a curated list, never `export *`: `runDiscovery`, `parseRules`, `shouldActivateRule`,
`resolveContextImports`, plus the `DiscoverySpec` / `DiscoveryScope` / `DiscoveryParser` types. The
tree behind it holds 13 files including YAML shims and parser internals a consumer never needs, and
publishing the directory would commit this package to every file in it.

Deliberately NOT under `internal/*`. Those subpaths are documented "internal API — semver-exempt",
`internal/persistence` is `@deprecated` in favour of a sanctioned barrel, and two siblings were
deleted as dead public surface. What is exported here is under semver.

**`resolveContextImports` is a wrapper, not a re-export, and the difference is a security boundary.**
The internal `resolveImports` takes `projectRoot` as an OPTIONAL field — correct for the callers that
predate 4.41.1, and a trap as a public contract: the obvious call omits it and silently restores the
un-contained behaviour that 4.41.1 patched, published under semver and therefore unfixable without a
breaking change. On the public surface the root is REQUIRED, asserted by a `@ts-expect-error` test.

`applyAggregateCap` is deliberately excluded: its `priority` field means "position among the SDK's
own seven specs", which is not a contract a consumer registering its own source can use.
