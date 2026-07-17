@AGENTS.md

## Claude Code — TheoKit SDK Extensions

This project uses `@theokit/sdk`. The AGENTS.md above contains the full API reference. Below are Claude Code-specific extensions.

### Available Skills (auto-loaded by domain)

These skills inject TheoKit knowledge automatically when you edit files matching their domain:

| Skill | Triggers on files matching |
|-------|---------------------------|
| `theokit-agent-core` | `*agent*`, `*Agent*`, `sdk.*` |
| `theokit-tools` | `*tool*`, `*Tool*` |
| `theokit-memory` | `*memory*`, `*Memory*`, `*embed*` |
| `theokit-di` | `*container*`, `*inject*`, `*provider*`, `*module*` |
| `theokit-di-agent` | `*decorator*`, `*Decorator*`, `di-agent*` |
| `theokit-gateways` | `*gateway*`, `*telegram*`, `*slack*`, `*discord*` |
| `theokit-workflows` | `*workflow*`, `*Workflow*`, `*step*` |
| `theokit-eval` | `*eval*`, `*Eval*`, `*scorer*` |
| `theokit-cron` | `*cron*`, `*Cron*`, `*job*`, `*schedule*` |
| `theokit-subscriptions` | `*subscri*`, `*sse*`, `*websocket*`, `*ws.*` |
| `theokit-errors` | `*error*`, `*Error*`, `*exception*` |
| `theokit-config` | `.theokit/**`, `config.*`, `theo.config.*` |
| `theokit-streaming` | `*stream*`, `*Stream*`, `*SDKMessage*` |
| `theokit-budget` | `*budget*`, `*Budget*`, `*cost*`, `*token*` |
| `theokit-models` | `*model*`, `*Model*` |
| `theokit-subagents` | `*subagent*`, `*a2a*`, `*delegat*` |
| `theokit-retry` | `*retry*`, `*Retry*` |
| `theokit-task-store` | `*task-store*`, `*taskstore*`, `*TaskStore*` |
| `theokit-sandbox` | `*sandbox*`, `*Sandbox*` |
| `theokit-compaction` | `*compact*`, `*Compact*` |
| `theokit-messages` | `*message*`, `*Message*` |
| `theokit-auth` | `*auth*`, `*Auth*`, `*envelope*` |
| `theokit-sanitize` | `*sanitize*`, `*Sanitize*` |
| `theokit-skills` | `*skill*`, `*Skill*` |
| `theokit-path-safety` | `*path-safety*`, `*pathsafety*` |
| `theokit-concurrency` | `*concurren*`, `*semaphore*`, `*Semaphore*` |
| `theokit-persistence` | `*persist*`, `*Persist*` |
| `theokit-client` | `*client*`, `*Client*` |
| `theokit-filesystem` | `*filesystem*`, `*Filesystem*` |
| `theokit-project` | `*project*`, `*Project*` |

### Settings

`.claude/settings.json` is pre-configured with safe defaults:
- Allows: `npm run *`, `pnpm *`, `git status`, `git diff`, reading `src/` and `docs/`
- Denies: `.env*` file reads, `sudo`, `rm -rf`
- Override locally: create `.claude/settings.local.json` (add to `.gitignore`)

### Customization

Add your project-specific instructions below this line. The SDK knowledge above stays current with your installed `@theokit/sdk` version.

```markdown
## My Project

Build: `npm run build`
Test: `npm test`
Lint: `npm run lint`

## Architecture
- `src/agents/` — agent definitions
- `src/tools/` — tool implementations
- `src/services/` — business logic
```
