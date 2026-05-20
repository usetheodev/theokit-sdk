# Cloud agent

Cloud agents run inside a Theo PaaS-managed VM with the target repo
cloned in. They can optionally open a PR with their result and expose
`listArtifacts()` / `downloadArtifact()` to read files produced inside
the VM workspace.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## Note on routing

Theo PaaS isn't deployed yet, so this example uses **fixture mode**
(API key starts with `theo_test_*`, no `THEOKIT_API_BASE_URL`). The SDK
emits the same cloud-shaped event stream (`status` → `assistant` →
`result`) and serves a deterministic fixture artifact list so
production code can be written against the cloud API today.

When PaaS ships, swap `.env` to:

```dotenv
THEOKIT_API_KEY=your-real-key
THEOKIT_API_BASE_URL=https://paas.usetheo.dev
```

…and the exact same example will hit the live runtime, no code
changes needed.

## What's demonstrated

- `cloud: { repos, autoCreatePR, startingRef }` configuration
- Cloud status events (CREATING / RUNNING / FINISHED) on `run.stream()`
- `result.git.branches[]` with PR URL
- `agent.listArtifacts()` / `agent.downloadArtifact(path)` for cloud-only files
