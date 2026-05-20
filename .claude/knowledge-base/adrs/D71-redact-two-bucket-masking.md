# D71 — Two-bucket masking: short fully masked, long preserves prefix+suffix

**Date:** 2026-05-18
**Status:** Accepted
**Related:** D68, plan `secret-redaction-discipline-plan.md`

## Decision

```typescript
function maskToken(t: string): string {
  if (t.length < 18) return "***";
  return `${t.slice(0, 6)}...${t.slice(-4)}`;
}
```

- Short tokens (< 18 chars): fully masked to `***`.
- Long tokens (>= 18 chars): preserve first 6 + `...` + last 4
  (e.g. `sk-abc...xyz1`).

## Rationale

Real-world credentials have a 50+ char common length (OpenAI sk-keys
51-56 chars, Anthropic sk-ant-keys 100+ chars). Long tokens are unique
per account, so a stable prefix+suffix is enough to identify "is this
the dev key or the prod key?" in an incident report — without revealing
the secret middle.

Short tokens (under 18 chars) tend to be either reusable shapes
(`sk-test`, `MOCK-KEY`, `dummy123`) — for which there's no security
value in showing a prefix — or padded short-form keys where the prefix
alone would be a fingerprint. Default to full mask.

The 18-char boundary lines up with the GitHub PAT classic prefix
(`ghp_` + 36 hex chars = 40 total) being long enough to show debuggable
bookends, while keeping placeholders like `sk-test` (7 chars) fully
masked.

Alternatives rejected:

- *Always mask everything to `***`* — less debuggable; incident reports
  cannot distinguish two leaked keys without revealing the secret.
- *Show prefix only* — operators rotate keys by suffix on dashboards.
- *Variable-length preservation (% of token length)* — invites bugs;
  fixed bookends are simpler.

## Consequences

- Enables operator debugging without revealing secrets.
- Tests assert the *non-leak property* (`expect(out).not.toContain(secret)`)
  plus optionally the *shape* (`/sk-[a-z]{3}\.\.\.[a-z]{4}/`); never
  exact equality against the bare `***` mask. Test migration in T0.2
  reflects this.
