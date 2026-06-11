# @theokit/gateway-sms

SMS platform adapter for [`@theokit/gateway`](../gateway).

Three backends, opt-in via peer-dep:

| Backend | Peer-dep | Inbound signature header |
|---|---|---|
| Twilio | `twilio` | `X-Twilio-Signature` (HMAC-SHA1 over URL+params) |
| Plivo | `plivo` | `X-Plivo-Signature-V3` (HMAC-SHA256) |
| Vonage | `@vonage/server-sdk` | `Authorization: Bearer <JWT>` |

## Install

```bash
pnpm add @theokit/sdk @theokit/gateway @theokit/gateway-sms

# Then install ONE of the backends you actually use:
pnpm add twilio              # for Twilio
pnpm add plivo               # for Plivo
pnpm add @vonage/server-sdk  # for Vonage
```

You also need `libphonenumber-js` (E.164 normalization) and `express` (webhook server). Both are listed as optional peer-deps and resolved on first use.

## Quick start (Twilio)

```ts
import { Agent } from "@theokit/sdk";
import { GatewayRunner } from "@theokit/gateway";
import { SMSAdapter, createWebhookServer } from "@theokit/gateway-sms";

const adapter = new SMSAdapter({
  backend: "twilio",
  accountSid: process.env.TWILIO_ACCOUNT_SID!,
  authToken: process.env.TWILIO_AUTH_TOKEN!,
  fromNumber: process.env.TWILIO_FROM!,
  // Public URL where Twilio will POST inbound — required for signature validation.
  publicUrl: process.env.PUBLIC_URL!, // e.g. https://abc.ngrok.io
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    if (event.platform !== "sms") return;
    await ctx.reply(`Echo: ${event.text}`);
  },
});

await runner.start();
const server = createWebhookServer({ adapter, port: 3000 });
await server.start();
```

### Twilio Console setup

1. Create a Twilio number with SMS capability.
2. In the number's *Voice & Messaging* configuration, set **A message comes in** → `Webhook` → `https://your-public-url/sms/twilio`.
3. Method: `HTTP POST`.

For local development, `ngrok http 3000` and use the `https://*.ngrok.io` URL.

## Signature enforcement (D392)

`SMSAdapter` refuses to start with an empty `authToken` — webhook public endpoint without HMAC validation is a known security hole. The constructor throws `ConfigurationError({ code: "signing_secret_required" })` if you try.

If a request arrives without (or with invalid) signature, the webhook responds `401 Unauthorized` BEFORE any handler dispatch.

## Multipart split (D393)

Outbound messages longer than 1600 chars are split into `(1/N) ...` / `(2/N) ...` parts. Split is grapheme-cluster safe (`Intl.Segmenter`) so emoji and combining characters are not severed.

Each part is one billable outbound message at the carrier. Plan accordingly.

## E.164 normalization (D391)

All phone numbers — inbound `sender.id`, outbound `channel.id` — are normalized to E.164 (`+5511999999999`) via `libphonenumber-js`. Non-parseable inputs throw `ConfigurationError`.

US toll-free numbers (`+18001234567`) are accepted (EC-6).

## What's NOT supported in v0.1

| Feature | Status | Workaround |
|---|---|---|
| MMS (image/audio attachment) | Deferred to v0.2 (D395) | Use Twilio API direct via `adapter.getBackendClient()` |
| Group SMS (MMS group thread on US carriers) | Not supported (D394) | — |
| Auto budget per-message charge | Deferred to v0.2 (D396) | Charge via your own counter |
| Delivery status callback (delivered/failed post-200) | Deferred to v0.2 (EC-13) | Subscribe via Twilio statusCallback URL |

## Live smoke

```bash
SMS_LIVE_SMOKE=1 \
TWILIO_ACCOUNT_SID=... \
TWILIO_AUTH_TOKEN=... \
TWILIO_FROM=+1... \
TWILIO_TO=+55... \
pnpm --filter @theokit/gateway-sms test
```

The live smoke sends one real SMS through Twilio's API (test creds work; they cost ~$0.01/SMS in production accounts). Skip by leaving `SMS_LIVE_SMOKE` unset (default).

## ADRs

D389 – D396 in `.claude/knowledge-base/adrs/`.
