# Installation

```bash
npm install @theokit/sdk
# or
pnpm add @theokit/sdk
# or
yarn add @theokit/sdk
```

## Requirements

| | Minimum | Notes |
| --- | --- | --- |
| Node.js | 22.12.0 | Node 20 reached end-of-life in April 2026. |
| TypeScript | 5.8 | Optional but strongly recommended. The SDK is type-first. |
| API key | — | See [Authentication](./authentication.md). Required for any runtime. |

## Optional peer dependencies

| Peer | Range | Why install |
| --- | --- | --- |
| `zod` | `^3.25 \|\| ^4` | Validate `AgentOptions`, `McpServerConfig`, or `CronCreateOptions` at runtime. Optional — the SDK works without it. |

## Verifying the install

```typescript
import { Agent, Cron, Theokit } from "@theokit/sdk";

console.log({ Agent, Cron, Theokit });
```

If the imports resolve and your editor surfaces full type information on hover, you're set.

## Package format

`@theokit/sdk` ships dual ESM + CJS with subpath exports:

| Entry | Import path |
| --- | --- |
| Main API | `@theokit/sdk` |
| Cron-only | `@theokit/sdk/cron` |
| Errors-only | `@theokit/sdk/errors` |

Use the subpath imports when you want minimal bundles or to make dependencies explicit.

## Next

→ [Quickstart](./quickstart.md)
