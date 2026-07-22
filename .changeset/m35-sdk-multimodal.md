---
"@theokit/sdk": minor
---

M35 (multimodal) — implement image input end-to-end. `agent.send({ text, images })` (the `SDKUserMessage` form) previously carried the `images` TYPE but the runtime dropped them (only `.text` was used). Now `prepareRunContext` carries the images, the agent loop attaches them as `image` content parts (new `LlmImagePart`), and the provider adapters serialize them: OpenAI/OpenRouter to a content-array with an `image_url` data URL, Anthropic to a native base64 image block. Text-only turns are byte-unchanged (back-compat). Zero new dependencies.
