---
"@theokit/sdk": patch
---

The `PermissionRule` documentation described a bug that was fixed, and told you to work around it.

The public docblock warned that a predicate matcher is invoked with `undefined` when the call omitted
the argument — so an allow-rule written to narrow would authorize an argument-less call, and a
deny-rule would throw a `TypeError` out of the permission gate. It closed by telling you to guard the
parameter in every predicate you write.

None of that has been true since `argMatches` started checking for a missing argument first, for
every matcher form. **A rule that declares an argument the call did not supply does not match, and
the predicate is not invoked.** You do not need the hand-written guards.

The fixed behaviour also had no test — deleting the guard left the entire suite green — so three
cases now cover it, including the two the old docblock described.
