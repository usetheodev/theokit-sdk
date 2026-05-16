# Authentication

Every SDK call needs an API key — either passed as the `apiKey` option, or set in the `THEOKIT_API_KEY` environment variable.

## Setting the key

```bash
export THEOKIT_API_KEY="your-key"
```

Then any SDK call without an explicit `apiKey` will use it:

```typescript
const agent = await Agent.create({
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
}); // pulls THEOKIT_API_KEY from env
```

Or pass per-call:

```typescript
const agent = await Agent.create({
  apiKey: "your-key",
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
});
```

## Key types

| Key type | Where from | When to use |
| --- | --- | --- |
| **User API key** | Theo Dashboard → Integrations | Personal scripts, dev tooling, CI bound to your account |
| **Service account API key** | Team settings → Service accounts | CI/CD, production cron jobs, anything that should outlive a person |
| **Team Admin API key** | — | Not yet supported by the SDK |

Both user and service account keys work for both local and cloud runs.

## Usage and billing

SDK runs follow the same pricing, request pools, and Privacy Mode rules as runs from the Theo IDE and Cloud Agents. Spend appears in your team's usage dashboard under the SDK tag.

## Security

- Keep API keys out of source control. Use `.env` files (gitignored) or your platform's secrets manager.
- Service account keys should be scoped to the minimum permissions needed.
- Rotate keys regularly — invalidating a key takes effect immediately.

## Next

→ [Quickstart](./quickstart.md) — your first agent run
