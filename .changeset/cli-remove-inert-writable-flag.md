---
"@theokit/cli": major
---

**Breaking:** `theokit setup gworkspace --writable <products>` is removed.

It granted nothing. The value was never parsed, never validated and never reached upstream; its
entire effect was a note printed after the OAuth flow had already completed, and only on one of the
three code paths. A permissions flag that does not affect permissions misleads in the dangerous
direction — a user reading `--help` concludes they chose a narrow grant while the consent screen
grants every scope upstream asks for.

Scope narrowing is not something this command can do: OAuth is delegated upstream (ADR D345) and
the upstream server offers no per-product grant. That fact now lives in the command's own
documentation, where it applies to every path rather than to one printed note.
