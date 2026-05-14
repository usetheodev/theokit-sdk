# Reference

The canonical, machine-readable contract lives at [`../../docs.md`](../../docs.md). It is the single source of truth — any conflict between this folder and `docs.md` is resolved by `docs.md` winning.

The files in this `reference/` folder are human-friendly cross-references and topic deep-dives, not a separate contract.

## What's where

| You want… | Look in |
| --- | --- |
| The exact shape of every public type | [`../../docs.md`](../../docs.md) |
| How to call each `Agent.*` method | [Concepts: Agent and Run](../concepts/agent-and-run.md) |
| How to call each `Cron.*` method | [Guides: Cron jobs](../guides/cron-jobs.md) |
| Error class hierarchy and retry strategy | [Guides: Error handling](../guides/error-handling.md) |
| Stream event taxonomy | [Concepts: Stream events](../concepts/stream-events.md) and [Stream events reference below](./stream-events.md) |
| Subpath imports (`/cron`, `/errors`) | [Installation](../getting-started/installation.md) |

## Top-level surface

```typescript
import {
  Agent,
  Cron,
  Theokit,
  // Errors (also at @usetheo/sdk/errors)
  AuthenticationError,
  ConfigurationError,
  IntegrationNotConnectedError,
  NetworkError,
  RateLimitError,
  TheokitAgentError,
  UnknownAgentError,
  UnsupportedRunOperationError,
  // Types
  type AgentOptions,
  type AgentPromptResult,
  type CronJob,
  type CronCreateOptions,
  type Run,
  type RunResult,
  type SDKAgent,
  type SDKAgentInfo,
  type SDKMessage,
  type SDKUserMessage,
  type SettingSource,
  type TheokitRequestOptions,
} from "@usetheo/sdk";
```

The full type contract is exported as named types from `@usetheo/sdk` — see `docs.md` for every interface.

## Static namespaces

| Namespace | Purpose | Methods (high-level) |
| --- | --- | --- |
| `Agent` | Create, manage, resume agents | `create`, `prompt`, `resume`, `list`, `get`, `listRuns`, `getRun`, `archive`, `unarchive`, `delete` |
| `Cron` | Schedule agent runs | `create`, `list`, `get`, `delete`, `enable`, `disable`, `run`, `start`, `stop`, `status` |
| `Theokit` | Account and catalog reads | `me`, `models.list`, `repositories.list` |

## Deep-dive pages

- [Stream events](./stream-events.md) — every `SDKMessage` variant
