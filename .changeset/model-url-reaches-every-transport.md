---
"@theokit/sdk": patch
---

`ModelSelection.url` names the endpoint a call should reach, and it reached only two of the four
transport branches. On `anthropic_messages`, `bedrock` and the Responses API it was silently
dropped: a run explicitly aimed at a local host went to the vendor instead, with the caller's key,
and nothing said so.

Measured on the anthropic branch: the local server recorded zero requests and the run failed with
`Anthropic API error: auth_failed (HTTP 401)` — a 401 from `api.anthropic.com`, after the caller
had named a different host.

All four branches now honour it, and it outranks the process-wide `*_API_BASE_URL` on each, which
is the contract the field's own documentation states. Nothing changes when it is absent.
