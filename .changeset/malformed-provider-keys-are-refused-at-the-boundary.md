---
"@theokit/sdk": patch
---

A malformed API key for a named provider is now refused when the agent is created, instead of failing
later wherever the key is first used.

The strict shape check existed and could never run. Deciding whether a key was headed for a provider
reused the predicate that decides whether a local runtime is available — and that one always answers
yes, because the SDK ships a local provider as a builtin. So the answer was no for every possible
input: the strict branch and the provider-prefix check were unreachable, and a key that could not
possibly work was accepted at the boundary.

The two questions are now answered separately. Whether to drive the real local runtime is still
decided where it always was. Whether a key reaches a provider that authenticates with it is decided by
that provider's own declared authentication type, so a provider that ignores keys entirely — the local
ones — accepts any shape, exactly as before.

Both unknowns stay permissive on purpose: an unrecognised model identifier or an unregistered provider
skips strictness. Rejecting a valid key blocks someone outright, while accepting a malformed one for a
provider we cannot identify only restores the previous behaviour for that case.

**This can newly reject keys that previously reached agent creation.** A short placeholder key paired
with a real provider prefix is the case to look for — two test suites in this repository were relying
on exactly that. Keys for local providers, fixture keys, and any setup with a base-URL override are
unaffected.

Also removes an authentication error that could not be raised: its condition depended on the same
always-true predicate, and the check that now does its job is the strict one above.
