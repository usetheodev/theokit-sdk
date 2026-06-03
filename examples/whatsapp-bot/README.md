# `examples/whatsapp-bot`

Reference WhatsApp bot using `@theokit/gateway-whatsapp` (Meta WhatsApp Business Cloud API backend).

## What you'll need

1. **Meta Developer App** with WhatsApp product added: <https://developers.facebook.com/apps>
2. **A phone number** provisioned in the app (test/sandbox is free, limit 5 recipients)
3. **A webhook URL** publicly reachable — use [ngrok](https://ngrok.com) locally
4. **An LLM provider key** (this example uses OpenRouter — sign up at <https://openrouter.ai>)

## Setup (8 steps)

### 1. Meta Developer App

Create an app at <https://developers.facebook.com/apps>. Add the **WhatsApp** product.

### 2. Get your phone-number-id + access token

In the WhatsApp product setup:

- **Phone number ID** (e.g. `123456789012345`) — copy it.
- **Temporary access token** — copy it for now (24h validity). For longer-lived auth, generate a system-user permanent token.

### 3. Get your app secret

App Dashboard → **Settings → Basic → App Secret** → "Show" → copy.

### 4. Pick a verify token

Any random string you'll match between Meta Console and your `.env` (e.g. `theo-whatsapp-verify-2026`).

### 5. Configure `.env`

```bash
cp .env.example .env
```

Fill in:

```bash
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_ACCESS_TOKEN=EAAxxxxx...
WHATSAPP_APP_SECRET=abc123def456...
WHATSAPP_VERIFY_TOKEN=theo-whatsapp-verify-2026
OPENROUTER_API_KEY=sk-or-v1-...
PORT=3000
```

### 6. Expose your local server

```bash
# In one terminal:
ngrok http 3000
# Note the https:// URL ngrok prints (e.g. https://ab12cd34.ngrok-free.app)
```

### 7. Tell Meta the webhook URL

In the WhatsApp product setup, **Configuration → Webhook**:

- **Callback URL:** `https://YOUR-NGROK-URL/webhook`
- **Verify token:** the same string you put in `.env` (`theo-whatsapp-verify-2026`)
- Click **Verify and save** — Meta hits `GET /webhook?hub.mode=subscribe&hub.challenge=...` and your server must echo the challenge. **The example does this for you.**
- Subscribe to `messages` field.

### 8. Pre-register test recipients

**Important sandbox rule:** WhatsApp Business sandbox can only message PRE-REGISTERED phone numbers (max 5). In the WhatsApp setup, add the WhatsApp number you'll test from as a "Recipient phone number".

## Run

```bash
pnpm install
pnpm run run
```

You should see:

```
[whatsapp-bot] listening on http://localhost:3000
[whatsapp-bot] webhook URL: http://localhost:3000/webhook
```

Now send a WhatsApp message from your pre-registered phone to the WhatsApp Business test number. The bot replies via the agent.

## Smoke test (one-shot send)

If you just want to verify the credentials work without setting up the webhook:

```bash
# Add WHATSAPP_TEST_PHONE=+5511999999999 to .env (pre-registered!)
pnpm run smoke
```

The smoke prints either a `wamid.xxx` on success or a clear error.

## Architecture

```
Phone (sender)
   │
   ▼
Meta WhatsApp Business Cloud API
   │   (sends webhook POST + signature header)
   ▼
ngrok → http://localhost:3000/webhook
   │
   ▼
Express + verifyWebhookSignature (HMAC-SHA256)
   │
   ▼
WhatsAppCloudBackend.handleWebhookPayload
   │
   ▼
WhatsAppAdapter.onInbound handler
   │   (wraps in MessageEvent)
   ▼
Agent.create / agent.send (LLM call)
   │
   ▼
adapter.sendMessage → WhatsAppCloudBackend.send → Meta API
   │
   ▼
Recipient phone (response delivered)
```

## Notes on Express middleware (important — EC-2)

The bot uses `express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } })` — the `verify` callback preserves the raw bytes BEFORE JSON parsing. Without this, the signature verification (HMAC of `rawBody`) ALWAYS fails because Express discards the original byte stream.

If you switch to Hono / Cloudflare Workers / Next.js routes, use the equivalent pattern: read `request.text()` or `request.arrayBuffer()` BEFORE parsing JSON.

## Troubleshooting

- **"Token rejected"** → access token expired. Generate a new one in the WhatsApp product setup.
- **"recipient_phone_number_not_in_allowed_list"** → recipient not pre-registered. Add it to the sandbox in Meta Console.
- **Webhook never receives messages** → verify GET handshake passed (Meta shows green "Connected") and that you subscribed to `messages` field.
- **Signature always invalid** → check that `verify: (req, _res, buf) => ...` middleware is wired BEFORE the route handlers.

## v1 limits

- Text only (image/audio/video/document inbound are ignored — see EC-4 in the plan).
- DM only (Cloud API delivers DMs via webhook; group support requires Meta-side opt-in).
- Group send works (you can send to a group id) but group RECEIVE needs a different webhook subscription.

## Companion: web bridge backend

The `WhatsAppWebBackend` (`whatsapp-web.js` subprocess) is the alternative for personal/dev accounts that don't have Meta Business verification. See the package README for setup.
