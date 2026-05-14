<p align="center">
  <a href="https://usetheo.dev">
    <img src="https://usetheo.dev/logo.png" alt="Theo" height="80" />
  </a>
</p>

<p align="center">
  <h1 align="center">@usetheo/sdk</h1>
  <p align="center">
    <strong>TypeScript SDK for the Theo agent harness</strong>
  </p>
  <p align="center">
    Same agent surface, local or cloud. No vendor lock-in.
  </p>
  <p align="center">
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
    <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5.8%2B-3178C6?style=flat-square&logo=typescript&logoColor=white">
    <img alt="Node" src="https://img.shields.io/badge/node-22.12%2B-339933?style=flat-square&logo=node.js&logoColor=white">
    <img alt="Status" src="https://img.shields.io/badge/status-public%20beta-orange?style=flat-square">
  </p>
</p>

---

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
