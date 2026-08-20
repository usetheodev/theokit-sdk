---
"@theokit/sdk": patch
---

Adds negative-case tests over two modules whose typed errors were never entered by any test.

A sweep of the SDK found 340 `throw new *Error` sites with roughly a third never executed. The error
hierarchy exists so callers can branch on a typed code, and the project's own testing rule requires a
negative case to assert the specific error and message rather than merely that something threw — so
an untested throw site is a contract nobody has checked.

The hook-source loader is now fully covered on its failure paths: an unreadable hooks file, malformed
JSON, a non-object root, a non-array event group, and an invalid command shape. Each asserts the
class, the code and a message substring. One pre-existing test that asserted only
`.rejects.toThrow(/hook/i)` is upgraded to the same standard — matching a regular expression against
a message is not the same as identifying which guard fired.

Agent-helper resolution gains the same treatment on four of its five uncovered throw sites. The
fifth is left untested on purpose and recorded: its condition cannot be false for any caller, because
a sibling predicate that feeds it returns a constant. Writing a test for it would require mocking
that predicate away in order to reach a line real callers cannot, which is the decoy pattern this
project has already removed three times.
