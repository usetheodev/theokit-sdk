# sms-bot example

End-to-end Twilio SMS echo bot using [`@theokit/gateway-sms`](../../packages/gateway-sms).

## Setup

```bash
cp .env.example .env
# Edit .env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, PUBLIC_URL, OPENROUTER_API_KEY
pnpm install
```

### Twilio Console

1. Sign in at [console.twilio.com](https://console.twilio.com).
2. Buy or pick a Twilio number with SMS capability.
3. Open the number's *Voice & Messaging* settings:
   - **A message comes in** → `Webhook`
   - URL: `${PUBLIC_URL}/sms/twilio`
   - Method: `HTTP POST`
4. Save.

### Public URL (for local dev)

```bash
ngrok http 3000
```

Copy the `https://abc.ngrok.io` URL into `.env` as `PUBLIC_URL`. Don't forget to update the Twilio Console webhook to the new ngrok URL each session (ngrok rotates the subdomain on free tier).

## Run

```bash
pnpm run
```

You should see:

```
✓ SMS bot listening on port 3000
  Twilio webhook URL: https://abc.ngrok.io/sms/twilio
  Send an SMS to your Twilio number to test.
```

Now SMS your Twilio number. The bot calls the LLM and replies in <160 chars.

## Live smoke (one-shot)

```bash
SMS_LIVE_SMOKE=1 TWILIO_TO=+551199999999 pnpm smoke
```

This sends ONE real SMS through Twilio's API (~$0.0075). To test the adapter without spending, leave `SMS_LIVE_SMOKE` unset.

## Costs

| Twilio operation | Approx cost |
|---|---|
| Send to US | $0.0075 |
| Send to BR mobile | $0.04 |
| Receive (inbound) | $0.0075 |

Each multipart segment is one billable message.

## What's NOT in this example

- MMS attachments (image/video) — deferred to v0.2 of the package.
- Multi-backend switching at runtime (Plivo/Vonage) — pick one backend per adapter instance.
- Budget-per-message tracking — wire your own counter or wait for v0.2.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `signing_secret_required` | Missing `TWILIO_AUTH_TOKEN` in `.env` |
| `401 invalid signature` | Webhook URL in Twilio Console doesn't match `PUBLIC_URL` exactly |
| `ECONNREFUSED` on receive | `ngrok` died or port mismatch |
| `invalid_phone_number` | Bot can only reply to numbers libphonenumber recognizes; check format |
