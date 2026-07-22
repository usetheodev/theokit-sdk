---
"@theokit/sdk": patch
---

M35 review follow-ups (fail-fast, no silent drop): a `{ url }` `SDKImage` is now forwarded as an `image_url` with the URL directly on OpenAI/OpenRouter (previously silently dropped in `buildUserContent`); and the ollama-native provider throws a typed `ConfigurationError` on an image part instead of silently discarding it (images require an OpenAI/OpenRouter model). `LlmImagePart.source` gains a `{ type: "url" }` variant.
