# di-agent-express dogfood

Minimal HTTP server demonstrating `@InjectAgent` + REQUEST-scoped Agent isolation per request.

## Run

```bash
cd examples/di-agent-express
OPENROUTER_API_KEY=... pnpm start
```

## Probe (parallel requests)

```bash
curl 'http://localhost:3030/chat?message=Reply%20PONG' &
curl 'http://localhost:3030/chat?message=Say%20hi' &
curl 'http://localhost:3030/chat?message=Three' &
wait
```

Each response includes `agentId` — should be DIFFERENT for each request (isolation guarantee).

## Graceful shutdown

`Ctrl+C` triggers `container.dispose()` — every singleton disposed in reverse construction order.

## Edge case (v1.2 EC-15)

Express middleware MUST wrap the entire handler in `container.runInRequest(...)`. Don't escape the Promise chain via `setImmediate` / `setTimeout` raw callbacks — AsyncLocalStorage doesn't propagate to those.
