# TheoKit Telegram Bot

A Telegram bot powered by `@theokit/sdk` and `@theokit/gateway-telegram`. Routes each inbound message through a per-user agent via `createAgentFactory`, streams the reply, and sends it back to Telegram. Requires a bot token from @BotFather.

## Usage

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token"
export THEOKIT_API_KEY="your-key"

# Start the bot
npx tsx src/index.ts
```
