---
"@theokit/sdk": patch
---

Device login now reports a non-JSON response as a typed error instead of a raw `SyntaxError`.

Every failure in the OAuth device flows is supposed to reach the caller as an `AuthCallbackError`
carrying a code the CLI can branch on. Three of the four entry points broke that contract: they
parsed the response with `res.json()`, so an endpoint answering with HTML — a captive portal, a
corporate proxy's sign-in page, a load balancer's error page — rejected with a `SyntaxError` that no
`catch` in the module handled. It escaped untyped past callers prepared only for `AuthCallbackError`.

Affected: `requestDeviceCode`, `requestOpenAIUsercode`, and the two-step poll inside
`openaiDeviceLogin`. The RFC 8628 poll loop was already safe and is unchanged.

The message now quotes the body (truncated), because "not JSON" and "not JSON, and it looks like a
proxy login page" are different diagnoses for whoever is holding the terminal — and sending someone
to debug the provider when the fault is their own network is the expensive kind of wrong.
