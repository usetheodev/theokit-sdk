---
"@theokit/sdk": patch
---

`sanitizeIdentifier` now reports every rejection as `ConfigurationError` with code
`invalid_identifier`.

It used to throw two classes and the input chose which: a NUL, C0 control char or DEL produced
`PathTraversalError` (code `path_traversal`), everything else produced `invalid_identifier`. A
caller branching on the documented code — the shape an HTTP handler uses to answer 400 — rethrew
for exactly the input class an attacker controls, so a rejection surfaced as a 500 and the 400/500
split became an oracle for which branch was reached. The input was rejected either way; this was
never a traversal bypass.

The message still names the offending byte (`<nul-byte>`, `<control-char-0x1f>`), which is the part
the second class existed for. `@theokit/sdk/workflow` validates step ids through this function and
inherits the fix.
