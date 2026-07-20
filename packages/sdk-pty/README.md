# @theokit/sdk-pty

Local, `node-pty`-backed implementation of `@theokit/sdk`'s `InteractiveBackend`.

Opt-in and **terminal-surface only** — this is the ONLY package in the theokit
ecosystem that depends on `node-pty` (optionally, so install never fails on a
native build). Core / `@theokit/sdk-tools` / cluster / desktop backends never
touch it.

```ts
import { PtyInteractiveBackend } from "@theokit/sdk-pty";
// inject into an interactive shell tool that depends on InteractiveBackend
const interactive = new PtyInteractiveBackend();
```

When `node-pty` is unavailable (or a spawn fails), every method throws the SDK's
typed `InteractiveUnavailableError` so the caller falls back to non-interactive exec.
