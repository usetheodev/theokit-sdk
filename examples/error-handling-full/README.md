# error-handling-full

Covers all 8 SDK error classes (extends the basic `error-handling` example).

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## The 8 error classes

| Class | Triggered by | Code field examples |
|---|---|---|
| `AuthenticationError` | Missing/invalid API key | `missing_api_key`, `embedding_unauthorized` |
| `ConfigurationError` | Invalid options shape | `missing_model`, `runtime_exclusive`, `cloud_incompatible_*` |
| `UnknownAgentError` | `Agent.get`/`getRun` with bad id | `unknown_agent`, `run_not_found` |
| `UnsupportedRunOperationError` | Local agent `downloadArtifact`, etc. | (carries `operation` field) |
| `NetworkError` | HTTP non-2xx from provider/PaaS | `embedding_http_error`, `cloud_run_http_error` |
| `RateLimitError` | HTTP 429 from provider | `embedding_rate_limit` |
| `IntegrationNotConnectedError` | Cloud integration missing connection | (carries `provider` field) |
| `TheokitAgentError` | **base class** — catch-all | — |

## Catch pattern

```ts
try {
  await agent.send(msg);
} catch (e) {
  if (e instanceof RateLimitError) await sleep(e.retryAfterMs);
  else if (e instanceof NetworkError) await retry();
  else if (e instanceof IntegrationNotConnectedError) await connect(e.provider);
  else if (e instanceof TheokitAgentError) logger.error({ code: e.code, retryable: e.isRetryable });
  else throw e;  // non-SDK error
}
```

`isRetryable` is a discriminator on `TheokitAgentError` — `NetworkError`
and `RateLimitError` are retryable; `AuthenticationError`, `ConfigurationError`,
and `UnsupportedRunOperationError` are not.
