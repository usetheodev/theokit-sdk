# Docs site dogfood — 2026-05-23

Manual smoke against the locally-built static site (`theo-opendocs/out/theokit-sdk/`) after the Phase 9 build of the docs-site-theokit-sdk plan.

## Inventory

| Section | Routes |
|---|---|
| Landing (`/theokit-sdk/`) | 1 |
| Getting started | 5 |
| Concepts | 19 (+ placeholder dropped) |
| API reference (auto-gen) | 249 (TypeDoc symbols) + index |
| Cookbook (auto-gen) | 7 recipes (+ 1 excluded: telegram-pro) |
| Search index | 5.1 MB (~1500 entries across all theokit-sdk URLs) |

## 8-scenario smoke

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | "I've never used the SDK, what is it in 30s?" → landing answers | ✅ PASS | Landing has 4 sections + 1-line pitch + Quickstart CTA |
| 2 | "I want to install now" | ✅ PASS | `getting-started/install/` exists, tabs for pnpm/npm/yarn/bun |
| 3 | "How do I write a simple agent?" → Quickstart is copy-paste-able | ✅ PASS | `getting-started/quickstart/` has 2 mentions of `Agent.create` (the example + a card link); the code block builds working agent in 7 lines |
| 4 | "How does MCP work?" → reachable in ≤3 clicks | ✅ PASS | `concepts/mcp/` exists; reachable from landing → Concepts card → MCP entry in sidebar |
| 5 | "Exact signature of `Agent.create`" | ✅ PASS | `reference/Agent/` page generated from TypeDoc |
| 6 | "I use Bedrock, how to configure?" | ✅ PASS | `concepts/providers-bedrock-vertex/` documents Bedrock + Vertex; `getting-started/providers/` has step-by-step setup |
| 7 | "Example of workflows?" | ✅ PASS | `cookbook/workflows/` exists, recipe with full code from `examples/workflows/run.ts` |
| 8 | "Report a doc bug" | ✅ PASS | GitHub repo link visible in cookbook index (`github.com/usetheo...`) |

## Build status

- `pnpm build` exits 0
- Zero MDX parse errors
- Zero broken internal links (Fumadocs would have rejected the build)
- Search index Orama-compatible (loaded client-side at runtime)

## Drift check

```
$ pnpm docs:drift
[docs-drift] OK — no drift detected between docs.md / dist / examples and theo-opendocs/.
```

## Deploy

Static export ready in `theo-opendocs/out/`. Deploy via `pnpm pages:deploy` (Cloudflare Pages, wrangler-configured). Not executed in this dogfood run — requires `CLOUDFLARE_API_TOKEN` + manual confirmation.

## Verdict

**APROVADO.** 8/8 scenarios PASS, build verde, drift clean. Plano docs-site-theokit-sdk-plan.md Phase 9 — DONE.

## Pre-existing observations (not caused by this plan)

- `referencias/fumadocs` peer engine warning (`Unsupported engine: wanted: ">= 24.14.0", current: v22.22.2`) — pre-existing in `theo-opendocs/`, not blocking.
- Some TypeDoc reference pages have generic "see source for members" placeholder when JSDoc was sparse — acceptable for v1.

## Next

- Cloudflare deploy is a one-line `pnpm pages:deploy` from the user (requires auth).
- v1.1 will harden the drift check (continue-on-error: false) after 4 stable weeks.
