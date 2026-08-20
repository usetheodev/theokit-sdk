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

Every published declaration file now compiles without `skipLibCheck` (#345). The
DTS rollup emitted symbols as a re-export from a chunk while omitting them from
that chunk's `import`, and dropped type-only imports from external packages —
leaving 51 unresolved references across ten of the twelve packages. Nothing broke
at runtime, and `tsc` stayed green for anyone with `skipLibCheck` on, but a
consumer running type-aware lint saw every type reached through one degrade to
`error`.

The declarations are repaired at build time from the compiler's own diagnostics.
No source or API change.
