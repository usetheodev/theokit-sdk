---
"@theokit/sdk": patch
---

A `PermissionRule` argument matcher written as a predicate was invoked with `undefined` when the
call supplied no such argument. The string and RegExp forms already treated a missing argument as
"does not match"; the predicate branch returned before that guard.

Both directions were wrong, and the first is a permission escape: an allow rule like
`(v) => v !== "prod"` returns `true` for `undefined`, so a call that supplied nothing produced an
explicit allow — a matcher written to narrow, widening. A deny rule like `(v) => v.includes("rm")`
raised `TypeError` out of the permission gate instead of denying.

A rule that declares an argument is a rule about that argument. A call that omitted it no longer
satisfies the rule, whatever form the matcher takes.
