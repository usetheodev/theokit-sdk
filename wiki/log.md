# Change log

## 2026-08-06

* **Creation**: Built the bundle from two sources, which were then removed from the repository.
  * `docs/` — `harness-capability-map.md` and `error-codes.md` moved (not rewritten) into
    `reference/`, preserving byte-fidelity of the import blocks that
    `scripts/check-capability-map.mjs` parses symbol by symbol. `docs/README.md` was a
    navigation page and was absorbed into this bundle's root `index.md` plus
    [Theo stack](project/theo-stack.md). `docs/course/theokit-agent-ai-course.md` (v1.0,
    2026-07-30, ~2,150 lines) was decomposed into the `concepts/`, `sdk/`, `operations/`,
    `ecosystem/` and `curriculum/` folders.
  * `.claude/knowledge-base/` — the three tracked records (one grill, one review, one
    code-quality audit) became the `project/` concepts of the same name.
* **Update**: Repointed the three committed gates that read the old `docs/` path —
  `packages/sdk/scripts/copy-docs.mjs`, `packages/sdk/tests/lint/shipped-docs.test.ts` and
  `scripts/check-capability-map.mjs` — at `wiki/reference/`. The npm ship-list contract is
  unchanged: `reference/` holds exactly the two consumer-facing reference concepts, and
  `shipped-docs.test.ts` still fails if a third one lands there without being added to the
  copy list.

### Coverage and boundary

Every unit of both sources is a concept or a recorded decision below. Nothing was dropped
silently.

* **Not crawled**: no external URL was fetched while building this bundle. The framework
  comparison in [ecosystem](ecosystem/framework-comparison.md) carries the source list the
  course recorded in July 2026 and is dated accordingly; its links were not re-checked.
* **Not re-verified**: the API surface described across `sdk/` was verified by the course
  author against `packages/sdk/src/types/` on 2026-07-30 at `@theokit/sdk@4.36.0`. This
  bundle transports those claims; it did not re-run the verification. The repository has
  since released 4.39.0, so `stale_after` on those concepts is set accordingly and no
  `verified` event was seeded on any of them.
* **Superseded on transport**: the course's own `[VERIFICAR]` markers and Appendix E notes
  are collected in [precision notes](project/precision-notes.md) rather than left inline,
  because two of them are open defects in this repository, not teaching caveats.
