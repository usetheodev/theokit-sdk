# @theokit/gateway

Multi-platform messaging gateway for `@theokit/sdk`. Transport-agnostic primitives — adapters live in separate peer-dep packages.

> **Status: 0.1.0 — pre-release.** Breaking changes allowed within the `0.x` line per semver.

## Install

```bash
pnpm add @theokit/gateway @theokit/sdk
# Plus one or more transport adapters:
pnpm add @theokit/gateway-telegram grammy
pnpm add @theokit/gateway-discord discord.js
```

## Architecture (5 pieces)

| Module | Responsibility |
|---|---|
| `BasePlatformAdapter` | Contract every adapter implements: `connect`, `disconnect`, `sendMessage`, `onInbound` |
| `GatewayRunner` | Orchestrator: holds adapters, dispatches inbound events to your handler |
| `SessionRouter` | Pure function: `MessageEvent → agentId` (composes `Agent.resume`, ADR D174) |
| `DeliveryRouter` | Dispatch outbound messages (composes `Cron`, ADR D175) |
| `HookExecutor` | `pre_inbound` / `post_outbound` / `on_error` hooks (own contract, ADR D176) |

## Minimal example

```typescript
import { Agent } from "@theokit/sdk";
import { GatewayRunner, SessionRouter } from "@theokit/gateway";
import { TelegramAdapter } from "@theokit/gateway-telegram";

const router = new SessionRouter();
const adapter = new TelegramAdapter({ token: process.env.TELEGRAM_BOT_TOKEN! });

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    const agent = await Agent.resume(router.resolveAgentId(event), {
      apiKey: process.env.OPENROUTER_API_KEY!,
      model: { id: "openai/gpt-4o-mini" },
    });
    const run = await agent.send(event.text);
    const result = await run.wait();
    await ctx.reply(result.result ?? "no reply");
    await agent.dispose();
  },
});

await runner.start();
```

## Design principles

- **Compose, don't reimplement.** The gateway never owns session persistence (SDK does), never owns scheduling (Cron does), never owns prompt resolution (SystemPromptResolver does).
- **Adapters are peer-dep packages.** Install only the transports you need.
- **Hooks live in the gateway, not the SDK.** Transport-layer concerns shouldn't pollute the SDK's Plugin contract.

See `.claude/knowledge-base/adrs/D170-D181-*.md` for the full design rationale.

## License

Apache-2.0
