---
"@theokit/sdk": patch
"@theokit/acp": patch
"@theokit/cli": patch
"@theokit/sdk-budget": patch
"@theokit/sdk-cache": patch
"@theokit/sdk-handoff": patch
"@theokit/sdk-memory": patch
"@theokit/sdk-pty": patch
"@theokit/sdk-tools": patch
"@theokit/memory-honcho": patch
"@theokit/memory-mem0": patch
"@theokit/memory-supermemory": patch
---

Public-API documentation reviewed file by file, and corrected wherever it disagreed
with the code. The docblocks ship in the `.d.ts`, so these read as behaviour changes
in an editor even though no behaviour changed.

The corrections that change what a caller would do:

- **`sdk-cache` documented its own premise backwards.** The header example labelled a
  semantic hit as if it avoided the provider call. `asPlugin()` returns the cached
  answer as `recalledContext`, which the agent loop injects as a `<memory-context>`
  block *before* the prompt — the request still goes to the provider. The two modes
  are now labelled separately, with a table saying which one short-circuits and which
  one seeds.
- **`sdk-handoff`'s five error classes said "throw".** Under the plugin wiring the
  handler never throws; every failure becomes a tool result `{"ok":false,…}` handed
  back to the model. Each class now says where it is actually observable. The header
  also told readers to `import { Handoff } from "@theokit/sdk"`, from which it was
  extracted.
- **`sdk-budget`'s `charge()` claimed idempotency across concurrent calls.** The mutex
  serialises, it does not deduplicate: two identical calls record twice. Related, and
  newly documented: with `maxUsd` set, a model missing from the pricing table denies
  every request rather than passing it — and the table matches by exact string, so
  `"openai/gpt-4o"` does not match `"gpt-4o"`.
- **The three `memory-*` adapters advertised an env-var fallback they do not read**,
  and their peer dependencies are required rather than optional. Their behavioural
  differences are now stated where they break the "interchangeable adapter"
  assumption — honcho ignores `k` and always throws on `delete`; mem0 recalls across
  sessions by design; supermemory ignores `sessionId` entirely.
- **`sdk-memory`'s `truncated` flag was documented as its own inverse**, and its
  dreaming sweep claimed a mutex it never takes against the writer it names.
- **`sdk-tools`** corrected `run_vitest`'s unreachable `no_vitest` code, `truncation`'s
  replacement-character claim, and two return shapes missing a live error code.
- **`acp`/`cli`** corrected sixteen statements including a named error class that is
  not the one raised, a handler documented as calling `fork()` that refuses
  unconditionally, handlers described as pure that mint ids and mutate a store, a
  config loader credited to Zod in a package that does not import it, and a `--force`
  scaffold described as atomic that deletes the destination before the rename.

Undocumented public symbols were documented across every package, with each claim
checked against the implementation rather than inferred from the name.
