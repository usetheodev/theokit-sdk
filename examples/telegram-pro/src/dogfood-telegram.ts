// Sends the dogfood checklist via the bot's own Telegram API to the
// configured TELEGRAM_ALLOWED_USERS[0] chat. The user sees the message
// arrive in their Telegram client and executes each item manually.
//
// Run: pnpm tsx --env-file=.env src/dogfood-telegram.ts
//
// Honest about limitations:
//   - Bots cannot impersonate users (Telegram filters bot-to-bot messages).
//   - User-side client automation requires MTProto + phone verification,
//     not feasible from this script.
//   - What this proves: bot token works + Telegram Bot API roundtrip OK.
//   - What still needs you: typing each command in your Telegram client.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (TOKEN === undefined || TOKEN.length === 0) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const allowed = (process.env.TELEGRAM_ALLOWED_USERS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
if (allowed.length === 0) {
  console.error("Missing TELEGRAM_ALLOWED_USERS — need at least 1 user id.");
  process.exit(1);
}
const targetUserId = Number(allowed[0]);
if (Number.isNaN(targetUserId)) {
  console.error("First TELEGRAM_ALLOWED_USERS entry is not a number:", allowed[0]);
  process.exit(1);
}

const api = `https://api.telegram.org/bot${TOKEN}`;
async function tgSend(text: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${api}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: targetUserId, text, parse_mode: "Markdown" }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

// Validate bot identity via getMe before sending anything.
const meRes = await fetch(`${api}/getMe`);
const meBody = (await meRes.json()) as { ok: boolean; result?: { username: string; id: number } };
if (!meBody.ok || meBody.result === undefined) {
  console.error("getMe failed — token invalid?", meBody);
  process.exit(1);
}
console.log(`Bot identity: @${meBody.result.username} (id=${meBody.result.id})`);
console.log(`Sending dogfood checklist to user_id=${targetUserId}...`);

const r = await tgSend(
  [
    "🤖 *Dogfood telegram-pro v1.2*",
    "",
    "Please execute these commands in this chat and report what you see:",
    "",
    "1\\. `/start`",
    "2\\. `/help`",
    "3\\. `/stream` _(should show: current mode = `wait`)_",
    "4\\. `/stream on`",
    "5\\. `Tell me about jazz music in one sentence.` _(streaming UX)_",
    "6\\. `/stream off`",
    "7\\. `/factstream jazz`",
    "8\\. `/migrate_memory`",
    "9\\. `/memory_lance`",
    "10\\. `/notion`",
    "11\\. `/skills` then `/skill <one-of-the-names-listed>`",
    "",
    "Reply with one of: ✅ all good, ⚠️ <command> issue, ❌ broken.",
  ]
    .join("\n")
    // Markdown V1 special chars need raw backslash escape for grammy v1 sendMessage.
    .replace(/\\\./g, "."),
);
console.log(`Notice send result: ok=${r.ok} status=${r.status}`);
if (!r.ok) console.log(`  body: ${r.body.slice(0, 200)}`);
process.exit(r.ok ? 0 : 1);
