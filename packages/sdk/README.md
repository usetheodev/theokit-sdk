# @usetheo/sdk

The TypeScript SDK for the Theo agent harness. Same agent surface, local or cloud.

> **Public beta.** APIs may change before general availability.

For the full reference, see the [root README](../../README.md) and [`docs.md`](../../docs.md).

## Install

```bash
npm install @usetheo/sdk
```

## Quick start

```typescript
import { Agent } from "@usetheo/sdk";

const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "composer-2" },
  local: { cwd: process.cwd() },
});

const run = await agent.send("Summarize what this repository does");

for await (const event of run.stream()) {
  console.log(event);
}
```

## Status

This package is a scaffold. The contract is defined in [`docs.md`](../../docs.md). Implementation lands incrementally — see [`CHANGELOG.md`](./CHANGELOG.md).

## License

MIT — see [LICENSE](./LICENSE).
