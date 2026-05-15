# Provider fallback

Configures a primary provider plus a fallback chain via
`AgentOptions.providers`. When the primary is unreachable
(bogus key, network error, rate limit), the SDK transparently
falls through to the next entry.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env       # paste OPENROUTER_API_KEY (used as fallback)
pnpm dev
```

The example deliberately sets `ANTHROPIC_API_KEY` to a bogus value
so the primary fails.

## ⚠️ Implementation status

`AgentOptions.providers.routes` and `providers.fallback` are declared
and the provider router resolves the chain at create time. The
**failover-on-error** behaviour — silently retrying with the next
provider when the primary returns 4xx/5xx — is NOT yet wired in the
real LLM runtime. Today a primary failure surfaces as `status=error`
on the Run instead of falling through.

Tracking: wrap `AgentLoopInputs.llm` in a chain-aware adapter that
catches `NetworkError` and retries against the next resolved client.

