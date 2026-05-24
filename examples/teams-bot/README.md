# `examples/teams-bot`

Reference Microsoft Teams bot using `@usetheo/gateway-teams`. Built on the modern `@microsoft/teams.apps` v2 SDK.

## What you'll need

1. **Microsoft Azure account** (free tier OK).
2. **Azure AD app registration** with Bot Framework configured.
3. **A webhook URL** publicly reachable — use [ngrok](https://ngrok.com) for local dev.
4. **An LLM provider key** (this example uses OpenRouter — sign up at <https://openrouter.ai>).

## Setup (8 steps)

### 1. Azure AD App Registration

Open <https://portal.azure.com> → **Microsoft Entra ID** → **App registrations** → **+ New registration**.

- **Name:** anything (e.g. `theo-teams-bot`)
- **Supported account types:** Choose `Single tenant` for org-only OR `Multitenant` for any work account
- **Register**

Copy:
- **Application (client) ID** → your `TEAMS_CLIENT_ID`
- **Directory (tenant) ID** → your `TEAMS_TENANT_ID`

### 2. Client secret

In the same app: **Certificates & secrets** → **+ New client secret** → 6/12/24 months. Copy the **Value** (not the Secret ID) → your `TEAMS_CLIENT_SECRET`.

### 3. API permissions (Microsoft Graph)

In the same app: **API permissions** → **+ Add a permission** → **Microsoft Graph** → **Application permissions** → grant your org's required minimum (typically none if you only respond to mentions). Click **Grant admin consent**.

### 4. Azure Bot Service registration

<https://portal.azure.com> → **Create a resource** → search **"Azure Bot"** → **Create**.

- **Bot handle:** anything (e.g. `theo-bot`)
- **Subscription / resource group:** pick yours
- **Pricing tier:** F0 (free) is fine
- **Microsoft App ID:** select **Use existing app registration** and paste your `TEAMS_CLIENT_ID`
- **Create**

### 5. Configure messaging endpoint

In the Bot resource: **Configuration** → **Messaging endpoint** → set to your future webhook URL: `https://YOUR-NGROK-DOMAIN/api/messages` (replace once you have ngrok running in step 7).

### 6. Configure `.env`

```bash
cp .env.example .env
```

Fill in:

```bash
TEAMS_CLIENT_ID=00000000-0000-0000-0000-000000000000
TEAMS_CLIENT_SECRET=your-client-secret-value
TEAMS_TENANT_ID=00000000-0000-0000-0000-000000000000
TEAMS_BOT_DISPLAY_NAME=Theo
OPENROUTER_API_KEY=sk-or-v1-...
PORT=3978
```

### 7. Expose your local server

```bash
ngrok http 3978
# Note the https:// URL (e.g. https://ab12cd34.ngrok-free.app)
```

Go back to step 5 and paste `https://ab12cd34.ngrok-free.app/api/messages` as the Messaging endpoint. Click **Apply**.

### 8. Install bot into Teams

In the Bot resource: **Channels** → **Microsoft Teams** → **Apply** to enable the Teams channel.

Then you need a Teams app manifest. The simplest path:

- Go to **Channels** → **Microsoft Teams** → **Open in Teams** to test 1:1 chat directly.
- For org-wide install, create a manifest via [Microsoft Teams Developer Portal](https://dev.teams.microsoft.com) and upload it.

## Run

```bash
pnpm install
pnpm run run
```

You should see:

```
[teams-bot] listening on http://localhost:3978
[teams-bot] webhook URL: http://localhost:3978/api/messages
```

Send a 1:1 message to your bot in Teams. The bot replies via the agent.

## Smoke test (validates credentials only)

If you just want to verify the credentials work without setting up Bot Service:

```bash
pnpm run smoke
```

The smoke prints PASS if the SDK accepts your tenant/client/secret combo, FAIL otherwise.

## Architecture

```
Teams client (you on phone / desktop)
   │
   ▼
Microsoft Teams backend
   │  (signs an outbound HTTPS request with JWT)
   ▼
ngrok → http://localhost:3978/api/messages
   │
   ▼
Express server (you control the lifecycle)
   │
   ▼
ExpressAdapter (from @microsoft/teams.apps)
   │  (JWT validated by SDK — D319)
   ▼
App.on("activity", ...)
   │
   ▼
TeamsAdapter.onInbound handler
   │  (normalizes MessageActivity → TeamsMessageEvent — D318)
   ▼
Agent.create / agent.send (LLM call)
   │
   ▼
adapter.sendMessage → app.send(conversationId, activity) → Teams
   │
   ▼
Recipient (response delivered)
```

## Notes on architecture

### Why `app.send(conversationId, activity)` not a `ConversationReference`

The Hermes Python adapter (`microsoft-teams-apps`) stored a `ConversationReference` per chat for proactive sends. The TypeScript v2 SDK simplifies: `app.send` takes a plain conversation-id string. The SDK manages the underlying reference internally. We just pass `event.channel.id` back when replying.

This is documented in [`gateway-teams-sdk-inspection.md`](../../.claude/knowledge-base/plans/gateway-teams-sdk-inspection.md) (Phase 0 of the plan).

### Why no rawBody middleware (unlike WhatsApp)

Teams JWT validation reads the `Authorization` header. The SDK doesn't HMAC-sign the body. Standard `express.json()` is sufficient — no `verify` callback needed.

## Troubleshooting

- **Bot doesn't see my message → "single-tenant" auth issue.** Your Azure AD app might be configured for single-tenant; messages from external tenants are silently rejected by the SDK. Check **App registrations → your app → Authentication → Supported account types**.
- **After restarting the bot, messages don't reach it.** When the bot was registered (step 4-5), the messaging endpoint took effect. Restarts don't break that. If they do, check that ngrok is on the same URL and the Bot Service Messaging Endpoint matches.
- **"WhatsAppConnectTimeoutError"-style hang on first connect.** SDK is verifying credentials with Azure — first call can take 5-10s on cold start. Wait.
- **401 in logs.** Token expired (client_secret older than its TTL) or wrong tenant_id. Regenerate the secret in step 2.

## v0.1 limits

- 1:1 + group chat + channel posts, text only.
- No Adaptive Cards first-class API (D320) — use `adapter.getApp()` escape hatch + the SDK's `AdaptiveCard` builder for rich UI.
- No status receipts (D323) — Teams Bot Framework doesn't emit clean `delivered`/`read` callbacks.
- ConversationReference is managed by the SDK (D317 — not stored ourselves).
