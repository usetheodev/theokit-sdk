# email-bot

Minimal example of an email-driven agent using `@usetheo/gateway-email`.

The agent listens on IMAP IDLE (or polls if the server doesn't advertise IDLE),
forwards every inbound message to the SDK, and replies via SMTP with RFC 5322
threading headers preserved (so the conversation stays in a single thread in
the user's inbox).

## Quick start (Gmail)

Gmail dropped basic-auth IMAP/SMTP in 2022. You MUST use an **App Password**:

1. Turn on 2FA: <https://myaccount.google.com/security>
2. Generate an App Password: <https://myaccount.google.com/apppasswords>
   - Select "Mail" + "Other (Custom name)" → name it `theo-email-bot`.
3. Copy the 16-character password.
4. Copy `.env.example` to `.env` and paste:
   - `EMAIL_ADDRESS=youraccount@gmail.com`
   - `EMAIL_PASSWORD=<16-char app password>` (no spaces)
5. Add your provider key: `OPENROUTER_API_KEY=sk-or-v1-...`

Then:

```bash
pnpm install
pnpm smoke   # one-shot: connects, verifies IMAP+SMTP, disconnects
pnpm run     # starts the live bot (Ctrl-C to stop)
```

Send an email to your address — the bot replies within ~5 seconds.

## Other providers

| Provider | IMAP                          | SMTP                       |
| -------- | ----------------------------- | -------------------------- |
| Gmail    | `imap.gmail.com:993`          | `smtp.gmail.com:587`       |
| Outlook  | `outlook.office365.com:993`   | `smtp.office365.com:587`   |
| Yahoo    | `imap.mail.yahoo.com:993`     | `smtp.mail.yahoo.com:587`  |
| Fastmail | `imap.fastmail.com:993`       | `smtp.fastmail.com:587`    |

Most providers require an App Password (not your account password). Check the
provider's docs.

## Filtering

By default the adapter drops:

- **Own-address loopback** (EC-1 CRITICAL): messages where `From: ==` your bot
  address. Prevents infinite reply loops when the bot CCs itself.
- **Automated senders** (D332): `noreply@`, `postmaster@`, `mailer-daemon@`,
  `bounce@`, `notifications@`, and any message with `Auto-Submitted: auto-*`,
  `Precedence: bulk|list`, or `X-Auto-Response-Suppress: all`.

To opt INTO automated senders (rarely a good idea): set
`allowAutomated: true` in `EmailAdapter` options.

To restrict to specific senders, set `EMAIL_ALLOWED_SENDERS` to a
comma-separated list. EC-3 lets you mix bracketed and plain forms:

```
EMAIL_ALLOWED_SENDERS=alice@example.com,"Bob" <bob@example.com>
```

## Troubleshooting

### "Authentication unsuccessful" / EAUTH

Gmail: confirm you're using an **App Password**, not your account password.
Outlook: ensure SMTP AUTH is enabled on the tenant (Microsoft disabled it by
default in 2023). For Microsoft 365 personal accounts, modern auth/OAuth2 is
strongly recommended over basic auth.

### Bot replies but the user's reply lands in a NEW thread

Some clients reject `In-Reply-To` headers that point to a non-existent
Message-ID in their archive. The bot keeps an in-memory `ThreadStore` capped
at 1000 entries (FIFO eviction). For threads older than that, the bot will
start a new thread on reply. This is documented behavior; persistence across
restarts is deferred.

### `[email-bot] dropped own-address loopback (uid=N)`

EC-1 working as intended — the bot rejected a message from its own address.
Usually triggered by:

- The bot being CC'd on its own reply (don't CC your own address).
- Mail rules / automation that forward to the bot from itself.

### Body looks truncated with `[truncated — full body in event.email.raw]`

EC-2 working as intended — bodies over 50000 chars get capped to keep token
costs predictable. To raise the cap, pass `maxBodyChars: 200_000` to the
`EmailAdapter` constructor. The full body is always available via
`event.email.raw` for advanced consumers.

### IMAP IDLE keeps disconnecting

Some servers drop IDLE after ~29 minutes (per RFC 2177). `imapflow` refreshes
automatically. If your server doesn't advertise IDLE at all, the adapter
falls back to polling — set `EMAIL_POLL_INTERVAL_MS=30000` to slow it down.

## See also

- `packages/gateway-email/` — adapter source
- ADRs D327-D339 — design rationale
- `.claude/knowledge-base/plans/gateway-email-plan.md` — full implementation plan
