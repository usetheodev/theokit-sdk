# react-nextjs — `@usetheo/react` hooks demo (3 hooks, 1 app)

Next.js 14 App Router demo covering all three React hooks shipped by `@usetheo/react`:

| Route | Hook | Server handler | Use case |
|---|---|---|---|
| `/chat` | `useTheoChat` | `streamTheoChat` | Multi-turn chat with history |
| `/completion` | `useTheoCompletion` | `streamCompletion` | Single-shot text generation |
| `/assistant` | `useTheoAssistant<FactCard>` | `streamAssistant` | Object-shaped streaming |

This consolidated layout (ADR D49) reduces scaffolding ~3× vs three separate Next.js apps.

## Setup

```bash
pnpm install --ignore-workspace
cp .env.example .env.local
# Edit .env.local and set ONE of OPENROUTER_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY
```

## Run

```bash
pnpm dev
# Open http://localhost:3000
```

Each route is independent — visit `/chat`, `/completion`, `/assistant` in any order.

## File layout

```
src/
├── app/
│   ├── layout.tsx                  # shared root layout
│   ├── page.tsx                    # nav (this file)
│   ├── chat/page.tsx               # "use client" + useTheoChat
│   ├── completion/page.tsx         # "use client" + useTheoCompletion
│   ├── assistant/page.tsx          # "use client" + useTheoAssistant<FactCard>
│   └── api/
│       ├── chat/route.ts           # streamTheoChat server handler
│       ├── completion/route.ts     # streamCompletion server handler
│       └── assistant/route.ts      # streamAssistant + FactCard schema
└── lib/
    ├── get-agent.ts                # SERVER-ONLY agent factory (cache singleton)
    └── schemas.ts                  # SHARED Zod schema (client + server)
```

## Warnings & gotchas

### `lib/get-agent.ts` is server-only

It uses `process.env` and the full SDK runtime. NEVER import it from a `"use client"` component — Next.js will refuse to bundle and the build will fail with a clear error. Only import from `app/api/*/route.ts`.

### Cold start serverless invalidates the cache singleton

On Vercel / AWS Lambda serverless functions, the `cachedAgent` module-scoped cache resets on each cold start. Correctness is still preserved because `Agent.getOrCreate` dedupes by `agentId` against the on-disk registry (ADR D22) — same `agentId` always resolves to the same persisted agent. But no in-memory reuse across invocations.

In `next dev` (long-lived process), the cache survives HMR reloads, so first request creates the agent and subsequent requests hit the cache.

### Schema sharing for useTheoAssistant

The `FactCard` schema lives in `lib/schemas.ts` as the single source of truth. Both:
- `app/assistant/page.tsx` (client) imports `FactCard` type
- `app/api/assistant/route.ts` (server) imports `FactCard` value

If you redefine the schema in two places with subtly different shape (e.g., one has `.min(1)` and the other doesn't), partial-parse on the client will silently fail and `isValid` will never become true. Always import — never inline.

### Next.js version

Tested against **Next.js 14.x**. Next 15+ may require adjustments to route handler shape (Server Components defaults changed, fetch caching semantics evolved). Open an issue if you hit incompatibilities.

### Build without provider key

`pnpm build` (`next build`) does NOT require provider keys — route handlers are `async` (server functions, not SSG), so they aren't called at build time. The agent factory only runs on the FIRST request to a route.

## Smoke test

```bash
pnpm install --ignore-workspace
pnpm build
# Expected: build succeeds, .next/ directory produced.

# Optional dev smoke:
pnpm dev &
curl http://localhost:3000/                  # 200 OK
# Visit each route in a browser; with a provider key set, send a message
# and observe streaming text deltas.
```

## See also

- ADR D40 — `.claude/knowledge-base/adrs/D40-react-hooks-family-separate.md`
- ADR D47 — `.claude/knowledge-base/adrs/D47-react-examples-nextjs-standalone.md`
- ADR D49 — `.claude/knowledge-base/adrs/D49-consolidated-react-example.md`
- Wire format spec — `packages/react/src/wire-format.md`
- SDK docs — `docs.md` § "@usetheo/react hooks (v1.2+)"
