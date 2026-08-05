---
"@theokit/sdk-memory": minor
"@theokit/sdk": patch
---

`@theokit/sdk-memory` now serves every embedding provider the SDK advertises (theokit#128).

`azure-openai`, `cohere`, `jina` and `gemini` landed in the SDK core catalog in June 2026 and the
satellite never picked them up. That was not cosmetic drift: when `@theokit/sdk-memory` is
installed, its catalog *replaces* core's in the routing path, while `Theokit.inspect.embeddingAdapters()`
kept listing all ten — so asking for one of the four got an "unknown provider" error from a provider
the SDK itself had just advertised. A cross-package test now fails the build if core ever advertises
a provider the peer cannot serve.

Also fixes the Azure OpenAI endpoint in both packages. Azure addresses the deployment in the URL
path (`/openai/deployments/{deployment}/embeddings`), and the placeholder was never substituted —
every Azure embedding request went to a URL containing the literal text `{model}` and could only
404. Providers with a static path are unaffected.
