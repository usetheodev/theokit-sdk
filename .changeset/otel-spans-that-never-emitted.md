---
"@theokit/sdk-cache": patch
"@theokit/sdk-handoff": patch
---

`@opentelemetry/api` is now declared as an optional peer dependency, so the spans these two
packages emit can actually reach a collector.

Both lazily `require("@opentelemetry/api")` from their own directory, but neither manifest
declared it in any dependency field. Under an isolated `node_modules` layout the specifier is
therefore not linked under the package, the require throws, the loader caches a `null` tracer,
and every span degrades to a no-op — silently, with no warning, unlike `@theokit/sdk`, which
prints one when telemetry is enabled and OTel is absent. For `sdk-cache` that covered both of
its main paths (`cache.lookup` on every send, `cache.store` on every reply), so an operator
reading a trace saw no cache activity at all and had no way to tell that from a cache that was
never consulted.

The declaration matches `@theokit/sdk`'s: `peerDependencies` plus `peerDependenciesMeta.optional`,
so nothing is installed for anyone who does not want OTel, and users who do want it get their
copy linked where the require can find it.
