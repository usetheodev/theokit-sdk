# cloud-with-skills

Demonstrates that `AgentOptions.skills.enabled` is serialized into the cloud
agent payload that TheoPaaS receives at `POST /v1/agents/{id}/runs`.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it does

1. Creates a cloud agent with `skills: { enabled: ["deploy", "review"] }`.
2. Prints `agent.cloudPayload` — the canonical JSON shape PaaS receives.
3. The payload shows `skills.enabled: ["deploy", "review"]` so PaaS can load
   the matching `.theokit/skills/<name>/SKILL.md` files from the cloned repo.

## Fixture mode caveat

PaaS isn't deployed yet. With `theo_test_*` key the SDK doesn't actually
call PaaS — it just builds and prints the payload. When PaaS ships, swap
`.env`:

```dotenv
THEOKIT_API_KEY=your-real-key
THEOKIT_API_BASE_URL=https://paas.usetheo.dev
```

Same code, no changes.
