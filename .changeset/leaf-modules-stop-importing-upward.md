---
"@theokit/sdk": patch
---

Two internal modules moved to the layer they belong to. No public API changed.

`src/errors.ts` is the package's leaf — fifteen files under `internal/runtime/` import the typed
error hierarchy from it — and it imported back up into `internal/runtime/retry/` for one helper. The
helper encodes which error codes are retriable, which is a property of the error taxonomy rather
than of the retry runtime, so it now lives in `internal/error-mappers/` beside the other mapping
knowledge. One import path changed; the file itself was moved, not rewritten.

`internal/security/` is the most-depended-upon module in the tree and held node builtins and
`errors.js` and one exception: a path-containment primitive it reached for in
`internal/runtime/context/`. That primitive had four consumers and only two were in the folder it
sat in — it lived there because that is where it was extracted from, not because it belonged there.
It is now `internal/security/path-containment.ts`, and all four consumers import downward into
`security/`, the direction the rest of the tree already runs.
