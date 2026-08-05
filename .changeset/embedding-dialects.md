---
"@theokit/sdk": minor
"@theokit/sdk-memory": minor
---

Three advertised embedding providers now actually work (theokit#159).

`azure-openai`, `cohere` and `gemini` were in the catalog and rejected on every call. The shared
runtime spoke exactly one wire — `Authorization: Bearer`, a `{ model, input }` body, a
`{ data: [{ embedding }] }` response — and none of the three speak it:

- **Azure** authenticates an API key with the `api-key` header (`Bearer` carries an Entra ID token,
  not the key from `AZURE_OPENAI_API_KEY`), and the deployment is already in the URL path, so
  `model` does not belong in the body.
- **Cohere**'s `/v2/embed` names the payload `texts`, requires `input_type`, and answers
  `{ embeddings: { float } }`.
- **Gemini**'s OpenAI-compatible surface is at `/v1beta/openai/embeddings`, not `/v1/embeddings`.

The runtime gained three optional per-provider hooks — auth headers, request body, response reader —
whose defaults are exactly the previous behaviour, so the seven providers that were already correct
are untouched. Each divergence is asserted by a test that records the real request.

Advertising a provider that cannot work is worse than not advertising it; that is what this closes.
