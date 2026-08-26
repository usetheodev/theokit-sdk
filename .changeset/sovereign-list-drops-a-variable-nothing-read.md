---
"@theokit/sdk": minor
---

`THEOKIT_DIR_NAME` no longer appears in `SOVEREIGN_ENV_KEYS`. It was documented there as naming the project config directory, and nothing ever read it — setting it did nothing. If you want the SDK to read configuration from `.claude` alongside `.theokit`, that now happens by default and needs no variable. `SOVEREIGN_ENV_KEYS` is public, so a consumer narrowing a type to it gains one fewer member.
