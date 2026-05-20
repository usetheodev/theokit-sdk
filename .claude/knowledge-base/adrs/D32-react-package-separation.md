# D32 — `@usetheo/react` as a separate workspace package

**Status:** Decided
**Date:** 2026-05-17

## Decision

Streaming-to-React helpers (`useTheoChat` hook and the server-side
`streamTheoChat` SSE handler) ship in a NEW workspace member,
`@usetheo/react`. They do NOT live inside `@usetheo/sdk`. The new package
peer-depends on `react ^18 || ^19` and on `@usetheo/sdk` (range pinned to
`^1.1.0` for publishing; `workspace:*` for internal dev). The over-the-wire
streaming protocol follows the **Vercel AI SDK Data Stream v1**
specification so existing `useChat` consumers can migrate without rewriting
their UI.

## Rationale

Three forces drove the split:

1. **Core SDK must stay React-free.** Many consumers run server-side
   (Node, edge, CLI, Telegram bot). Bundling React types into
   `@usetheo/sdk` would force them to either install React or live with
   peer-dep warnings. The Anthropic SDK, OpenAI SDK and Vercel AI all
   keep React in a separate subpath or package for the same reason.
2. **Independent versioning.** React API stability differs from the SDK
   API stability. Shipping React patches to fix hydration bugs shouldn't
   force an SDK release; shipping an SDK breaking change shouldn't force
   React consumers to test a new hook the same week.
3. **Wire format compatibility.** Following Vercel's Data Stream v1
   gives drop-in migration from `useChat` to `useTheoChat`, plus
   ecosystem compatibility with any chat UI that already speaks that
   protocol (e.g., `@ai-sdk/ui-utils`).

Alternatives considered:

- **Subpath export** (`@usetheo/sdk/react`) — rejected because subpaths
  still install React deps into the same package tree, and bundlers may
  not tree-shake reliably across subpaths.
- **Custom wire format** — rejected because we'd build alone and migrate
  no one. Vercel's protocol is stable since v4.

## Consequences

- Two npm packages to publish on each release (`@usetheo/sdk` and
  `@usetheo/react`). Release process needs a changeset coordination step.
- Internal dev uses `"@usetheo/sdk": "workspace:*"` so changes are
  reflected immediately; published artifacts pin `^1.1.0` so consumers
  can upgrade independently.
- We commit to following Vercel Data Stream upgrades — if v2 lands and
  breaks v1, we either follow or fork. The wire format is documented
  inline in a small markdown spec inside the React package so the
  fingerprint is captured at release time.
- Adding a new React feature does not require touching the core SDK
  source tree; conversely, an SDK internal refactor doesn't risk
  breaking React state machines.
