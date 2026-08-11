---
"@theokit/sdk": minor
---

`applySecurityFloor` — a lower-trust configuration layer may tighten a security setting, never loosen it.

Layered configuration usually resolves last-wins, and for the keys that decide confinement that is a
hole: a project layer outranks the user's own file, so a cloned repository can hand itself the most
permissive sandbox and the operator's global choice loses silently, at the moment the directory is
opened. Nothing fails; the confinement is simply gone.

The rule is generic and the vocabulary is not, so the vocabulary is parameters: which values count
as more permissive, which layers are restricted, and which layer is the operator's explicit
override. A second product supplies its own without inheriting the first's words.

The override is returned verbatim even when outside the vocabulary — validating the operator's flag
is the consumer's job, and silently dropping an unrecognised one is worse than passing it through. A
value outside the vocabulary in a RESTRICTED layer is ignored instead: a typo in a repository's
config must neither become the effective setting nor read as maximally permissive.

Additive. Nothing calls it yet.
