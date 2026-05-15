# Typed error handling

Every SDK error extends `TheokitAgentError` and carries a stable `code`
string. Catch the specific subclass and branch on `cause.code` for
fine-grained handling.

This example triggers three error categories deterministically:

| Trigger | Error | Stable code |
| --- | --- | --- |
| `Agent.create({ apiKey: "" })` | `AuthenticationError` | `missing_api_key` |
| Both `local` and `cloud` passed | `ConfigurationError` | `runtime_exclusive` |
| `Agent.get("agent-does-not-exist-...")` | `UnknownAgentError` | `unknown_agent` |

No provider key needed — the example uses fixture mode (or pre-flight
validation rejections) so the errors fire without network.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## Other error classes (not exercised here)

- `RateLimitError` — provider returned 429
- `IntegrationNotConnectedError` — cloud SCM integration missing
- `NetworkError` — non-2xx HTTP from upstream
- `UnsupportedRunOperationError` — calling `cancel()` on a historical cloud run
