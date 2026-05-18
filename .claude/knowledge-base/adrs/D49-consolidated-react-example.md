# D49 — React example consolidado (1 app, 3 rotas) ao invés de 3 apps separados

**Status:** Decided
**Date:** 2026-05-17

## Decision

`useTheoChat` + `useTheoCompletion` + `useTheoAssistant` (3 hooks) ganham UM example consolidado: `examples/react-nextjs/` com 3 rotas (`/chat`, `/completion`, `/assistant`) + 3 route handlers (`api/chat`, `api/completion`, `api/assistant`) numa única app Next.js.

NÃO criar 3 examples separados (`react-chat-nextjs`, `react-completion-nextjs`, `react-assistant-nextjs`).

## Rationale

- **Scaffolding compartilhado** — 3 examples separados teriam 3× duplicação de `package.json`, `next.config.mjs`, `tsconfig.json`, `layout.tsx`. Consolidado reduz a 1×.
- **Comparação lado a lado** — dev abre o app, navega entre `/chat`, `/completion`, `/assistant` e entende quando usar cada hook na mesma sessão.
- **`lib/get-agent.ts` compartilhado** — todos os 3 route handlers usam o mesmo agent factory; consolidado expõe esse pattern naturalmente.
- **Bundle size do example NÃO importa** — não é prod, é demo. Code-splitting do Next.js já cuida em runtime.

Alternativas consideradas:

- **3 apps Next.js separados**: rejeitado por duplicação massiva (~600 LoC scaffolding vs ~200 LoC consolidado).
- **1 app com 1 rota multi-mode**: rejeitado — conflate 3 conceitos numa página; UX confuso.
- **Monorepo de apps com workspace**: rejeitado — adicionar segundo nível de pnpm workspace dentro de `examples/` é over-engineering.

## Consequences

- Matriz Feature → Rota é DOCUMENTADA no README do example (e no `examples/README.md` global) — sem isso, dev não sabe qual rota cobre qual hook.
- Tracking "1 feature = 1 example" fica menos puro — Feature Matrix global precisa apontar para `react-nextjs#/chat`, `react-nextjs#/completion`, etc.
- `tools/typecheck-examples.sh` conta como 1 example PASS (não 3) — total dos examples sobe de 41 para 46 (era esperado 48 se fosse 3 separados; aceitável).
- Mudança futura: se algum dos hooks precisar de scaffolding muito diferente (e.g., custom auth provider para useTheoChat), podemos quebrar em apps separados via segundo plano sem violar essa decisão (D49 governa o estado atual, não é proibitiva).
