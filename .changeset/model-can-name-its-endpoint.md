---
"@theokit/sdk": minor
---

`ModelSelection.url` — a model can name the endpoint it should reach.

The base URL came only from a process-wide env var (`OLLAMA_HOST`, `OPENAI_API_BASE_URL`) or the
provider profile's shipped default, so every `ollama/*` model in a process shared one host. An app
could not run a small model on localhost and a large one on a GPU box, and could not talk to two
OpenAI-compatible servers at once. The information had nowhere to travel: `ProviderRouterOptions`
carried no URL field at all (usetheokit/theokit-sdk#332).

```ts
model: { id: "ollama/llama3.3:70b", url: "http://gpu-box:11434" }
```

Precedence is `ModelSelection.url` → the provider's base-URL env var → `profile.baseUrl`. The model
outranks the env var deliberately: with the env var winning, whoever set it for one model would keep
hijacking every other one, which is the same bug wearing a hat.

Leaving `url` unset changes nothing — `ollama/qwen2.5:3b` still resolves to `http://localhost:11434`
from the profile, with no key and no setup.

Applied to both transports separately, because they do not share the override: `OllamaNativeClient`
(the native `/api/chat` path Ollama tool calling requires) and the OpenAI-compatible client, which
covers `lmstudio` and `llamacpp`. The tests assert the URL the stubbed `fetch` actually received
rather than the options object handed to the client — an options-level assertion passes with the
precedence inverted.
