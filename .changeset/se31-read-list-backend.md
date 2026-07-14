---
"@theokit/sdk-tools": patch
---

SE31 gap closure — wire the read-side file factories to the optional `filesystem` backend. `createReadFileTool` and `createListDirTool` now accept the same optional `filesystem` provider as `createWriteFileTool`, so a per-request / multi-tenant root isolates READS and LISTINGS too (previously only writes routed through the backend). Omitted ⇒ identical current behavior (local process fs). `createGlobTool` / `createSearchTextTool` remain on local fs in v1 — they need recursive traversal the minimal non-recursive `FilesystemBackend` seam does not expose (deferred follow-up).
