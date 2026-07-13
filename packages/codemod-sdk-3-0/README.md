# @theokit/codemod-sdk-3-0

Migrate a codebase from `@theokit/sdk` **2.x** to **3.0** (SE36 — uniform `X.create()` API).

In 3.0 every public factory was removed in favor of a uniform static-namespace form:

| 2.x (removed) | 3.0 |
| --- | --- |
| `defineTool(...)` | `Tool.create(...)` |
| `defineProvider(...)` | `Provider.create(...)` |
| `definePlugin(...)` | `Plugin.create(...)` |
| `defineSkillReadTool(...)` | `SkillReadTool.create(...)` |
| `defineSubAgent(...)` | `SubAgent.create(...)` |
| `createSquad(...)` | `Squad.create(...)` |
| `createSkill(...)` | `Skill.create(...)` |
| `createSessionManager(...)` | `Session.create(...)` |
| `createAgentFactory(...)` | `AgentFactory.create(...)` |
| `createNoopMemoryProvider(...)` | `NoopMemoryProvider.create(...)` |
| `createPermissionPlugin(...)` | `PermissionPlugin.create(...)` |
| `createTokenLimiter(...)` | `TokenLimiter.create(...)` |
| `createUnicodeNormalizer(...)` | `UnicodeNormalizer.create(...)` |
| `defineSubscription(...)` | `Subscription.create(...)` |
| `createSemaphore(...)` | `Semaphore.create(...)` |
| `defineAuth(...)` | `Auth.create(...)` |
| `withRetry(fn, opts)` | `Retry.create(fn, opts)` |

`Agent.create`, `Cron.create`, `Workflow.create`, `Budget.create` are unchanged (they were
already `X.create`).

## Usage

```bash
# dry-run (prints the diff, changes nothing)
npx @theokit/codemod-sdk-3-0 --root src

# apply in place
npx @theokit/codemod-sdk-3-0 --root src --write
```

The transform is purely syntactic (jscodeshift, TypeScript parser). It rewrites BOTH the import
specifiers from `@theokit/sdk` and its subpath entrypoints (`@theokit/sdk/retry`,
`@theokit/sdk/subscription`, `@theokit/sdk/server/auth`, `@theokit/sdk/concurrency`, …) AND the
call sites. Review the diff before committing — a codemod is a starting point, not a guarantee.

## What it does NOT do

- It does not touch imports from other packages.
- It does not migrate type-only references beyond the factory identifiers (e.g. a bare
  `typeof withRetry` in a `ReturnType<>` needs a manual tweak to `typeof Retry.create`).
- `Retry.create` is an **executor**: it runs the fn and resolves to the result (`Promise<T>`),
  not a `Retry` instance — the `.create` name is the SE36 uniformity mandate (ADR 0015 / ADR-P2).
