---
"@theokit/sdk-memory": patch
---

Raises the `@theokit/sdk` peer floor from `>=4.53.1` to `>=4.54.0`.

Not because this package outgrew 4.53.1 — because **4.53.1's own published declarations do not
compile**. Building against it fails inside the SDK's `.d.ts`, not in any code here:

```
@theokit/sdk/dist/index.d.ts(350,24):  error TS2552: Cannot find name 'AgentBuilderDeps'
@theokit/sdk/dist/index.d.ts(3004,15): error TS2304: Cannot find name 'DECLARED'
```

#345 (`e368fc18`) bound the re-exported names the rollup had left unimported, and first shipped in
4.54.0. A floor that names 4.53.1 therefore promises a version nobody can build against.

Worth separating from the sibling fixes in this release: those floors were wrong because the code
had outgrown them. This one is wrong because the version it names is broken — a distinct reason to
audit a floor, now recorded beside it.
