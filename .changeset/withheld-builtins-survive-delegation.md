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

**There is no known limit on reaching this field from a wrapping layer.** An earlier draft of this
entry claimed one — that a layer re-exporting `Agent` under a narrowed type could not pass it — and
that was wrong. Checked against the published declaration: such a narrowing is written as
`Omit<typeof Agent, 'list'> & { list(…) }`, which narrows only `list`, so `create` keeps this
package's signature and the field crosses with types and without a cast. The claim came from
searching a wrapper's `.d.ts` for the field NAME, which is absent there because the type composes by
reference rather than redeclaring it — the wrong artefact for the question.

It is corrected here rather than deleted because a false limit recorded upstream is worse than none:
a reader takes it as settled and stops trying.

Found by the `theocode` session, which discovered its own "read-only" role holding a `shell` by
enumerating the tool catalog — after two probes that asked the model instead, and got answers that
contradicted it.
