---
"@theokit/sdk": patch
---

`SessionManager` gains an optional `getCookieSecret()`, the member `defineAuth`
uses to encrypt the OAuth transaction cookie.

It is additive: a manager without it falls back to `THEOKIT_OAUTH_TX_SECRET`
exactly as before. What changes is that the orchestrator no longer casts its own
port away to read an undeclared `secret` field — a shape no conforming
implementation could supply.
