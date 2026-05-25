# skills-google-workspace cookbook

Six runnable recipes for `@usetheo/skills-google-workspace`. All recipes use the bundled `google-workspace-mcp` server (read-only by default; recipes 5 & 6 require `writable: true`).

## Setup (one-time, ~5 minutes)

```bash
# 1. Install deps
pnpm install

# 2. Stage Google OAuth credentials.
#    This pre-validates your credentials.json shape (Desktop OAuth client)
#    and shells out to upstream `google-workspace-mcp setup` + `accounts add`.
npx theokit setup gworkspace

# 3. Copy .env.example to .env and fill in OPENROUTER_API_KEY +
#    GOOGLE_APPLICATION_CREDENTIALS (defaults to ~/.google-mcp/credentials.json)
cp .env.example .env
```

## Recipes

| # | Recipe | Mode | What it does |
|---|---|---|---|
| 01 | `recipe-01-list-upcoming-events.ts` | read-only | Lists upcoming Calendar events in plain text |
| 02 | `recipe-02-search-drive.ts` | read-only | Searches Drive for files matching a query |
| 03 | `recipe-03-read-google-doc.ts` | read-only | Reads + summarizes a Google Doc |
| 04 | `recipe-04-read-sheet.ts` | read-only | Reads a range from a Sheet and describes it |
| 05 | `recipe-05-create-event-writable.ts` | **writable** | Creates a test calendar event |
| 06 | `recipe-06-combined-meeting-doc.ts` | **writable** | Combined: next meeting → draft agenda Doc |

```bash
pnpm recipe-01
pnpm recipe-02 "Q4 budget"
pnpm recipe-03 "Roadmap 2026"
pnpm recipe-04 1abc...DEF "Sheet1!A1:D10"
pnpm recipe-05         # requires writable scope on Calendar
pnpm recipe-06         # requires writable scope on Drive
```

## Read-only default (D343)

By default `googleWorkspace()` runs the MCP server with `--read-only`. Write tools (`createCalendarEvent`, `createGoogleDoc`, `writeSpreadsheet`, `sendGmailDraft`, ...) return errors. Recipes 5 & 6 explicitly opt in:

```ts
mcpServers: googleWorkspace({ writable: true })
```

The OAuth token itself is broad (covers all granted scopes at consent time); `--read-only` is a runtime safety on top of that.

## Troubleshooting

### "skipped — OPENROUTER_API_KEY not set"

Set `OPENROUTER_API_KEY` (or any provider key the SDK supports) in `.env`.

### "skipped — GOOGLE_APPLICATION_CREDENTIALS not set"

Run `npx theokit setup gworkspace` to stage `~/.google-mcp/credentials.json`. After it succeeds, `GOOGLE_APPLICATION_CREDENTIALS=$HOME/.google-mcp/credentials.json` is the value to put in `.env`.

### Web vs Desktop OAuth client (EC-1)

If `theokit setup gworkspace` reports `"Web application" OAuth client`, you downloaded the wrong type. Re-create in Google Cloud Console as **Desktop application** and re-download.

### "Drive write rejected" / 403 in recipes 5 or 6 (EC-4)

The OAuth consent was granted in read-only mode. Re-run `theokit setup gworkspace --writable=drive,calendar` so upstream re-consents with the wider scope set.

### First-run OAuth blocks waiting for browser (EC-9)

Run `npx theokit setup gworkspace --probe` BEFORE the first recipe so the browser OAuth dance happens up-front in the terminal, not mid-recipe.

### Recipe loops process count (EC-10)

Each `Agent.create()` spawns ONE `npx google-workspace-mcp serve` subprocess. If you run multiple recipes in parallel, you'll see one process per recipe. For batch workloads, share a single agent across prompts.

## See also

- Package source: `packages/skills-google-workspace/`
- Plan: `.claude/knowledge-base/plans/skills-google-workspace-plan.md` v1.2
- Phase 0 audit: `.claude/knowledge-base/reviews/gworkspace-mcp-inventory.md`
- Upstream MCP: <https://github.com/pm990320/google-workspace-mcp>
