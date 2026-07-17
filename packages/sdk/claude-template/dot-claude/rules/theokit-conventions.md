# TheoKit SDK Conventions

## Agent lifecycle
- Always use `Agent.create()` to create agents — NEVER `new Agent()`
- Always call `agent.dispose()` or use `await using` when done
- Use `Agent.prompt()` for one-shot operations (auto-disposes)

## Imports
- Use `@theokit/sdk` for core (Agent, Tool, Cron, Memory)
- Use `@theokit/sdk/errors` for error types
- Use `@theokit/sdk/subscription` for SSE/WebSocket
- Use `@theokit/sdk/cron` for scheduled jobs
- Use `@theokit/sdk/eval` for evaluation
- Use `@theokit/sdk/workflow` for workflows
- NEVER import from `@theokit/sdk/internal/...`
- NEVER import from `@theokit/sdk/dist/...`

## Tools
- Tool `inputSchema` MUST use Zod schemas — NEVER `any` or untyped objects
- Tool `handler` MUST return a string (or a value matching `outputSchema` when set)

## DI
- Use `@Injectable()` + `@Inject()` from `@theokit/di`
- NEVER manually `new` a service — let the container resolve it

## Error handling
- Catch `TheokitAgentError` (base class) and check `error.code`
- NEVER silently swallow errors — log with context or rethrow

## Gateways
- One gateway per agent instance
- Configure via `defineGateway()` from the specific gateway package
