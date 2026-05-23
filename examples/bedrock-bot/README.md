# example: bedrock-bot

One-shot Claude prompt via AWS Bedrock (`@usetheo/sdk` Adoption Roadmap #8; ADRs D286-D302).

## Setup

1. Enable Bedrock model access in your AWS account: <https://console.aws.amazon.com/bedrock/home> → "Model access" → request Anthropic models.
2. Generate a Bearer token (one of three paths):
   - **Short-term, AWS Console:** IAM → Users → your user → "Security credentials" → "Bedrock API keys" → "Generate API key" (≤12h TTL).
   - **Long-term via CLI:**
     ```bash
     aws iam create-service-specific-credential --service-name bedrock.amazonaws.com
     ```
     (only for exploration — AWS docs warn against long-term keys in prod).
   - **Auto-refresh via peer dep:**
     ```bash
     pnpm add @aws/bedrock-token-generator
     ```
     Then the SDK refreshes short-term tokens automatically (D287).
3. Copy `.env.example` to `.env` and fill `AWS_BEARER_TOKEN_BEDROCK`.

## Run

```bash
cp .env.example .env
# fill AWS_BEARER_TOKEN_BEDROCK
pnpm install
pnpm run run                           # default question: "Qual é a capital do Brasil?"
pnpm run run "What's 2+2?"             # custom question
```

## Model IDs

Format: `bedrock/{regionPrefix}.anthropic.{model}-v{N}:{rev}`.

Examples:
- `bedrock/us.anthropic.claude-sonnet-4-5-v1:0` — US-region
- `bedrock/eu.anthropic.claude-sonnet-4-5-v1:0` — EU region (different inference profile)
- `bedrock/global.anthropic.claude-opus-4-7-v1:0` — cross-region routed

See [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html) for the full list per region.

## v1 limitations (documented)

- **Non-streaming only** (D302) — the full response arrives at once; chat UX with token-by-token rendering needs v1.x or the escape hatch via `@aws-sdk/client-bedrock-runtime`.
- **Bearer auth only** (D286) — no SigV4 in v1 (D298). Customers in IAM-role-only environments wait for v1.x.
- **InvokeModel only** (D289) — Converse API deferred. Preserves Anthropic prompt-caching + extended-thinking fields.
- **Claude only** — Llama / Cohere / Mistral via Bedrock Converse deferred (D296).
- **Bearer auth doesn't cover** Bedrock Agents / Knowledge Bases / Computer Use (D282-style escape hatch via `adapter.getApp()` not yet wired here).
