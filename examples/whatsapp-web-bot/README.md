# `examples/whatsapp-web-bot` — UNOFFICIAL backend

WhatsApp bot using the **unofficial** `whatsapp-web.js` subprocess bridge backend (ADR D305).

> [!CAUTION]
> ### Account ban risk
>
> WhatsApp **does not officially support automation of personal accounts**. Using `whatsapp-web.js` (or any other WhatsApp Web bridge: Baileys, etc.) violates the [WhatsApp Terms of Service](https://www.whatsapp.com/legal/terms-of-service) and can result in **permanent account suspension**.
>
> Use this backend for:
> - Local development and prototyping
> - Personal automation on a throwaway number
>
> Do NOT use for:
> - Production bots serving real users (use the [Cloud backend](../whatsapp-bot) for that — Meta-sanctioned, sandbox tier free)
> - Anything that requires account stability

## When to use this vs the Cloud backend

| Need | Backend |
|---|---|
| Production, real users, B2C | [`whatsapp-bot`](../whatsapp-bot) (Meta Cloud) |
| Personal phone, dev, prototyping | this example (Web bridge) |
| Group messages with WhatsApp Web reach | this example (Cloud doesn't deliver groups by default) |
| Zero infrastructure (no webhook URL, no public host) | this example |
| Multi-device support, status receipts, robust uptime | Cloud |

## Prerequisites

1. **Node 22.12+**
2. **A WhatsApp account on a phone you control** (you'll scan a QR code from it).
3. **Disk space ~150 MB** for Chromium + Puppeteer (`whatsapp-web.js`'s peer deps).
4. **OpenRouter (or any provider) API key** for the agent.

## Setup

```bash
cp .env.example .env
# edit .env: set OPENROUTER_API_KEY (and optionally WHATSAPP_SESSION_ID, WHATSAPP_BOT_PHONE)
pnpm install
```

`pnpm install` will pull in `whatsapp-web.js` (which transitively installs Puppeteer + Chromium). First install can take 1-2 minutes.

## Run

```bash
pnpm run run
```

On **first run**, the bridge subprocess prints a QR code to stderr. Open WhatsApp on your phone → ⋮ Menu → **Linked devices → Link a device** → scan the QR.

After successful pair:

```
[whatsapp-web-bot] connected (session: my-bot). Send a WhatsApp message to test.
```

Now send a WhatsApp message to your own number from another contact and watch the bot reply.

## Session persistence

`whatsapp-web.js` saves credentials in `./.wwebjs_auth/session-<SESSION_ID>/`. Subsequent runs use the same session — no QR rescan needed unless you log out from the phone.

To rotate sessions, change `WHATSAPP_SESSION_ID` in `.env` (will require a fresh QR scan).

## Group conversations

By default, groups are dropped (D309 + EC-7: require @mention). Set `WHATSAPP_BOT_PHONE` in `.env` to enable the mention filter (digits-only normalizer matches `@5511...`, `@+5511...`, `@99999-9999`, etc.).

## Lifecycle

The bridge runs as a child process under the bot. PID file at `$THEOKIT_HOME/whatsapp-bridge-<SESSION_ID>.pid` (default: `~/.theokit/`). On restart, the bot detects stale PIDs and kills them — **but only if the cmdline matches `whatsapp-web-bridge`** (EC-5 safety guard).

Press `Ctrl+C` to shut down cleanly. The bridge sends `SIGTERM` → 3s grace → `SIGKILL`.

## Troubleshooting

- **"WhatsAppConnectTimeoutError"** → you didn't scan the QR within 120s. Re-run.
- **"whatsapp-web.js not installed"** → run `pnpm install` again. The bridge subprocess detects the peer dep at boot.
- **Bot stops responding mid-session** → WhatsApp likely flagged it. Check phone for "device disconnected". You may have triggered the ban risk.
- **Puppeteer "No usable sandbox"** → on Linux without sandbox, the bundled bridge passes `--no-sandbox` to Chromium. Already handled.
- **QR code regenerates repeatedly** → check `.wwebjs_auth/session-<id>/` directory is writable.

## Architecture (vs Cloud)

```
Cloud backend                    Web bridge backend
─────────────                    ──────────────────
Meta webhook → POST URL          (no inbound URL — subprocess holds session)
   │                                 │
   ▼                                 ▼
Express server                   Bridge subprocess (whatsapp-web.js)
   │                                 │  stdio JSON-lines IPC
   ▼                                 ▼
WhatsAppCloudBackend             WhatsAppWebBackend
   │                                 │
   ▼                                 ▼
WhatsAppAdapter ←───── identical adapter surface (D303) ────→ WhatsAppAdapter
   │                                 │
   ▼                                 ▼
Agent.create / agent.send        Agent.create / agent.send
```

Same `WhatsAppAdapter` surface — your application code is identical whichever backend you pick.

## Companion: official Cloud backend

For production / B2C: see [`examples/whatsapp-bot/`](../whatsapp-bot). Same agent loop, different backend instantiation.
