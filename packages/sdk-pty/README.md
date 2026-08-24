# @theokit/sdk-pty

Local, `node-pty`-backed implementation of `@theokit/sdk`'s `InteractiveBackend`.

## Install

```bash
pnpm add @theokit/sdk-pty
```

`@theokit/sdk` (>=4.4.1) is a peer dependency. `node-pty` is an OPTIONAL dependency of this package,
so an environment that cannot build the native module still installs — and every method then throws
the SDK's typed `InteractiveUnavailableError`, which is the signal to fall back to non-interactive
exec rather than a crash at import time.

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

## API reference

Every symbol this package exports, with the exact specifier to import it from, is in the generated
capability map that ships inside `@theokit/sdk`:

```
node_modules/@theokit/sdk/docs/harness-capability-map.md   # symbol -> import specifier
node_modules/@theokit/sdk/docs/error-codes.md              # every `code` an error can carry
```

Both are generated from the built type declarations, so they describe the version you installed
rather than the version someone wrote a page about.
