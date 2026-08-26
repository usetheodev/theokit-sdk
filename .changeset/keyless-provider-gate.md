---
"@theokit/sdk": patch
---

A provider that does not take its credential from the caller is no longer refused for lacking one.
`createLocalAgent` read the provider descriptor two lines below the `throw` that guaranteed
execution never reached it, so `ollama/llama3.2` failed with `missing_api_key` before any runtime
work began — and so did every OAuth profile, Bedrock and Vertex.

Only `authType: "api_key"` requires a key from the caller. The other four modes source their own:
`none` sends no Authorization header at all, and `aws_bearer` / `gcp_oauth` / `oauth_device_code` /
`oauth_external` build their client with a placeholder and resolve a real token at stream time.

Fail-closed is preserved in both directions that matter: an unregistered provider prefix yields no
profile and is still refused, so a typo cannot become a free pass; and a provider that does
authenticate is refused exactly as before.
