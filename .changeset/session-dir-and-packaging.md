---
"@theokit/sdk": minor
---

**`local.sessionDir` replaces `local.baseDir`** (#301). "Base directory" read as the directory the agent works in, in an interface whose `cwd` is the option that actually means that — so `baseDir: "./"` ran without error and wrote session transcripts into the caller's repository root. `baseDir` still works and still resolves to the same place; it emits a deprecation diagnostic, and `sessionDir` wins if both are set.

**`isValidTaskId` and `TASK_RESERVED_PREFIXES` now exist at runtime** (#279). The bundled `.d.ts` had declared both as values since 4.51.1 while `dist/index.js` exported neither, so `import { isValidTaskId } from "@theokit/sdk"` typechecked clean and threw at the call site.

**Four `@theokit/sdk/persistence`, `@theokit/sdk/path-safety` and `@theokit/sdk/mcp-auth` symbols now arrive typed** (#280). Thirteen re-exports across those sub-entries resolved to no declaration, because the symbols carried `@internal` and `stripInternal` deleted it. They were usable and untyped — `atomicWriteText` in particular hid that it is `async`, so a caller could skip the `await` and see a write report success before the bytes landed.

**`OTelSpan` and `TelemetryHandle` are exported** from the root entry. Types only; nothing is added to the bundle.
