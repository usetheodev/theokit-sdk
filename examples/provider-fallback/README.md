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

## Behaviour

The chain is wrapped in `FallbackLlmClient` when its length is > 1.
On every `agent.send()`:

- The primary provider is tried first.
- If its HTTP handshake throws `NetworkError` (non-2xx status), the SDK
  logs a one-line diagnostic to stderr and retries with the next entry.
- Once a provider has yielded its first event, failover is OFF for that
  stream — partial output would corrupt the response.
- An aborted signal between attempts short-circuits the chain (EC-3) —
  the next provider is NOT called.
- If every provider in the chain fails, the last `NetworkError` is
  re-thrown.

Set both `ANTHROPIC_API_KEY` (bogus) and `OPENROUTER_API_KEY` (valid)
to observe the failover — the run prints `status=finished` and the
stderr line shows which provider failed.

