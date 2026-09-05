---
"@theokit/sdk": patch
---

A delegated child can no longer recover a builtin tool its parent withheld (#580)

**This is a security fix.** Measured before the change:

```
parent: withheldBuiltinTools: ["shell"]
child:  undefined
```

`withheldBuiltinTools` crossed no carrier at all — not `InheritedCredentials`, not
`buildChildCreateOptions` — so delegation **widened** authority the operator had revoked. That is the
inverse of #578 and materially worse: there the child was merely over-restricted.

It bites because of a documented default: a `shell` tool is always registered on a local agent,
*including when you pass `tools: []`*. Withholding is the only mechanism that removes it, so a
withholding that does not survive delegation leaves a child no way to be without a shell. Nor is
`sandboxOptions` a substitute — `{ enabled: false }` does not restrict the shell, it removes the
sandbox around it.

Two changes:

- The parent's withheld set is carried to the child.
- `SubAgentSpec` accepts `withheldBuiltinTools`, so a role declared read-only can actually be one.

**The child's list is the UNION of its own and the parent's, never a replacement.** Every other field
on the spec lets the role's value win — `model`, and `sandbox` (an explicit `sandbox: false` really
does turn confinement off for a child of a confined parent, which is documented and intended). That
asymmetry is deliberate: a posture is declared, whereas withholding removes a capability from the
catalog, and the failure is silent. So `withheldBuiltinTools: []` on a role subtracts nothing — a
restriction may be tightened by a child and never loosened.

Verified with a negative control: 6 of the 7 new tests fail against the pre-fix sources, and the one
that passes is the control asserting unchanged behaviour.

**Known limit, stated rather than implied:** a consumer whose layer re-exports `Agent` under a
narrowed option type cannot pass this field even though the runtime accepts it. That narrowing lives
outside this package and is not addressed here.

Found by the `theocode` session, which discovered its own "read-only" role holding a `shell` by
enumerating the tool catalog — after two probes that asked the model instead, and got answers that
contradicted it.
