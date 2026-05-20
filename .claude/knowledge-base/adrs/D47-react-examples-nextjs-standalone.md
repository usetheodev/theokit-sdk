# D47 — React examples são apps Next.js standalone (App Router)

**Status:** Decided
**Date:** 2026-05-17

## Decision

Os examples React do `@usetheo/react` são apps Next.js 14 standalone (App Router), não componentes isolados nem demos via Vite. Cada example tem `package.json`, `next.config.mjs`, `tsconfig.json`, `app/layout.tsx`, e usa o pattern Route Handler (`app/api/*/route.ts`) para o servidor.

## Rationale

- **Devs React em 2026 esperam Next.js como o "default React framework"** — Vercel publica métricas mostrando Next.js liderando adoption no ecossistema React. CRA está deprecated; Remix existe mas tem menos share; Vite + custom server é setup overhead.
- **`streamAssistant`, `streamCompletion`, `streamTheoChat` foram desenhados para Next.js Route Handlers** — eles retornam `Response` objects diretamente, encaixando no shape esperado por `app/api/*/route.ts`. Qualquer outro framework (Express, Hono, Fastify) exigiria adapter extra.
- **App Router permite ilustrar Server Actions + route handlers + client components lado a lado** — todos os 3 hooks aparecem em rotas separadas do mesmo app, dev vê os 3 patterns numa única árvore de diretórios.
- **`transpilePackages` + workspace file links resolvem clean no Next.js 14+** — pattern testado.

Alternativas consideradas:

- **Vite + custom Express server**: rejeitado — duplicação de boilerplate (2 servidores: Vite dev + Express API), config split em 2 arquivos, sem App Router story.
- **React component standalone (sem framework)**: rejeitado — hooks `useTheoChat`/`useTheoCompletion`/`useTheoAssistant` fazem fetch para `/api/*`; sem servidor, example não funciona end-to-end.
- **Remix**: rejeitado — adoption menor que Next.js; SDK não testa primariamente contra Remix.
- **Astro com React islands**: rejeitado — niche; complexidade adicional para o que é demo simples.

## Consequences

- Cada React example tem ~5-8 arquivos (page.tsx + route.ts + layout + config). Peso ~200 LoC total.
- Dev faz `pnpm install && pnpm dev` para boot; primeira request lazy-loads o agent.
- Bundle size do example NÃO é otimizado (é demo, não prod) — sem code-splitting agressivo, sem prefetch tuning.
- Quando Next.js 15 sair, example pode quebrar (Server Components defaults, fetch caching) — README documenta pin em 14.x.
- Não cobre frameworks que NÃO são Next.js — outros frameworks que consumem o pacote `@usetheo/react` ficam por conta do user (handler shape é `Request → Response`, compatível com qualquer Web Standard runtime).
