# @usetheo/react

> **Versioning note (2026-06-02):** package.json was at 1.0.0 (last published) while internal CHANGELOG drifted to 2.0.0/3.0.0 (changeset artifacts that never landed in npm). Aligning forward: 1.0.0 → 1.1.0 with the additive G3 + hooks-family surface that landed in workspace post-1.0.0.

## 1.1.0 - 2026-06-02

### Added

- **`useAction<TInput, TData>(action, options?)` hook** (G3 plan). Typed mutation hook binding to `defineAction` server actions via `@theo/actions` virtual module. Object-return shape `{ data, error, isPending, mutate, mutateAsync, reset, variables }` per ADR D2 of g3-server-actions-and-useaction plan. Optimistic/rollback opt-out v1 (consumer manages). Companion exports `ActionErrorLike` + `UseActionResult` types.
- **`useTheoChat` / `useTheoCompletion` / `useTheoAssistant`** — React hooks family (ADR D40). Consume SSE wire format (a peer vendor AI Data Stream v1, ADR D38). Each hook owns its lifecycle + abort semantics. Type aliases re-exported (`UseTheoChatOptions`, `UseTheoChatResult`, `ChatMessage`, etc).
- **`@usetheo/react/server` sub-path** — server route handlers `streamAssistant`, `streamCompletion`, `streamTheoChat`. Separated from client barrel because they import `@usetheo/sdk` (node:fs/path) at module-eval time and would leak into client bundle. Mirrors Next.js `next/server` pattern.

### Notes

- npm dist-tags before this publish: `latest: 1.0.0`. Drift discovered during dogfood-app release sweep 2026-06-02 noite when dogfood-app bumped from `file:` workspace link to `@usetheo/react@^1.0.0` — TS2305 on `useAction` import surfaced the missing export. Honest fix forward: publish the workspace surface as 1.1.0.

## 3.0.0 (changeset artifact — NEVER published; aligned forward to 1.1.0 above)

### Patch Changes

- Updated dependencies
  - @usetheo/sdk@1.3.0

## 2.0.0

### Patch Changes

- Updated dependencies
  - @usetheo/sdk@1.2.0
