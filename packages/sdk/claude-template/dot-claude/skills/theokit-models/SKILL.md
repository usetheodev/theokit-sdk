---
user-invocable: false
paths:
  - "**/*model*"
  - "**/*Model*"
description: TheoKit SDK model helpers — @theokit/sdk/models (parseModelId, resolveModelCapabilities, toModelOption, humanizeModelName); API catalog via Theokit.models.list()
---

# TheoKit Models

Pure, sync, offline helpers for model ids. No network — these read a static catalog
and parse strings. For the live API-backed catalog, use `Theokit.models.list()` from
the main `@theokit/sdk` barrel.

```typescript
import {
  parseModelId,
  resolveModelCapabilities,
  toModelOption,
  humanizeModelName,
  type ModelCapabilities,
  type ModelOption,
  type ParsedModelId,
} from "@theokit/sdk/models";
```

## Parse a model id

`parseModelId` splits on the first `/` into `{ provider, name }`. No `/` means
`provider` is `undefined` (so callers can fall back to env-var detection). Tag
suffixes like `:3b` / `:latest` stay part of `name`.

```typescript
const a: ParsedModelId = parseModelId("anthropic/claude-3-5-sonnet");
// { provider: "anthropic", name: "claude-3-5-sonnet" }

const b = parseModelId("openrouter/meta-llama/llama-3");
// { provider: "openrouter", name: "meta-llama/llama-3" }  (embedded slash kept)

const c = parseModelId("claude-sonnet-4-6");
// { provider: undefined, name: "claude-sonnet-4-6" }
```

## Gate features by capability

`resolveModelCapabilities` returns typed flags + token limits from an OFFLINE
catalog. It strips routing prefixes (`openrouter/`/`vertex/`/`bedrock/`) and the
OpenRouter `:variant` suffix before lookup; unknown models get conservative defaults.

```typescript
const caps: ModelCapabilities = resolveModelCapabilities("anthropic/claude-3-5-sonnet");
// { supportsVision, supportsStructuredOutput, supportsToolUse,
//   supportsCacheControl, maxContextTokens, maxOutputTokens }

if (!caps.supportsVision) {
  throw new Error("This model cannot accept images");
}
```

## Build dropdown options

`humanizeModelName` produces a best-effort label; `toModelOption` composes it with
`parseModelId` into `{ value, label, provider }`.

```typescript
humanizeModelName("anthropic/claude-3-5-sonnet"); // "Claude 3 5 Sonnet"

const opt: ModelOption = toModelOption("openrouter/meta-llama/llama-3");
// { value: "openrouter/meta-llama/llama-3", label: "...", provider: "openrouter" }
```

## Live catalog (API-backed)

```typescript
import { Theokit } from "@theokit/sdk";

const models = await Theokit.models.list({ apiKey: process.env.THEOKIT_API_KEY });
const options: ModelOption[] = models.map((m) => toModelOption(m.id));
```
