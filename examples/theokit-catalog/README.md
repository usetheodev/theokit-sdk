# Theokit catalog

Demonstrates the `Theokit` namespace — the read-only catalog endpoints
that surface user identity, available models, connected repositories,
and the provider catalog.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## Routing

The SDK routes catalog reads based on configuration:

| Configuration | Path |
| --- | --- |
| `THEOKIT_API_BASE_URL` set + real key | Real HTTP against the PaaS catalog endpoint |
| Fixture key (`theo_test_*`) + no base URL | Deterministic fixture data (this example's default) |

The example ships with a fixture key so it runs out of the box. When
Theo PaaS ships, swap `.env` to a real `THEOKIT_API_KEY` + `THEOKIT_API_BASE_URL`
to hit the live catalog without code changes.
