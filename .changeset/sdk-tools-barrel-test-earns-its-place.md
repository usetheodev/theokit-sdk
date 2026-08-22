---
"@theokit/sdk-tools": patch
---

The barrel-export smoke test now asserts behaviour, not just that a name is a function.

It was flagged as redundant with four build gates that supposedly enforce the same public surface.
Measured, the four do not reach this package at all: two are filtered to a different package by name,
one hardcodes a path under that package, and the fourth's configuration declares only two workspaces,
neither of them this one. Proved by renaming an exported factory and running all four — every one
stayed green, and only this test noticed.

So deleting it would have removed the only coverage of that surface. It keeps its export checks and
gains a case that invokes a factory and asserts the tool descriptor it returns — name, description,
input schema and handler — which is the behavioural assertion no build gate can make.
