# D173 — `MessageEvent` is a discriminated union by `platform`

**Date:** 2026-05-21
**Status:** Accepted

## Decision

`MessageEvent` exposes a `platform: "telegram" | "discord" | ...` literal discriminator; platform-specific extensions live in optional sibling fields (`telegram?`, `discord?`) typed by the corresponding adapter package.

## Rationale

TypeScript's discriminated union gives compile-time exhaustiveness checks for free. Putting Telegram-specific fields directly on `MessageEvent` (Hermes does this in Python via dataclass inheritance) would make the core type un-extendable without churn every time a new platform lands.

## Consequences

- **Enables:** safe `switch (event.platform)` blocks with exhaustive-check compiler errors when a new platform is added; per-platform fields available after narrowing.
- **Constrains:** platform-specific fields require a check on the discriminator before access. Acceptable — standard TypeScript pattern.
