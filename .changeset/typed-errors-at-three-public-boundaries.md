---
"@theokit/sdk": patch
---

Three public failure paths now carry a type and a code instead of a sentence.

`normalizeSchema` threw bare `Error` for both of its failures — a missing
`@valibot/to-json-schema` peer and an unsupported schema — so a caller could
branch on nothing but the message. Both are `ConfigurationError` now, with codes
`valibot_converter_missing` and `unsupported_schema`. It also detects the missing
peer from `err.code === "ERR_MODULE_NOT_FOUND"` before falling back to matching
the message text.

Resuming an agent whose persisted workspace path exists but is a file now says
so, instead of reporting it as "missing or inaccessible".

Subscription error frames carry the server error's own `code` over the wire, and
the WebSocket client prefers it over its blanket `ws_server_error`. A caller can
tell an invalid input from a disconnect without parsing English.
