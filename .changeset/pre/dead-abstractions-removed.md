---
"@theokit/sdk": patch
---

Two abstractions with no implementers and no consumers are gone. Nothing published changes.

`internal/security/secret-redactor.ts` declared a `SecretRedactor` interface that `redactSecrets`
happened to satisfy. It was added to raise the module's abstractness out of a coupling metric's "zone
of pain", and nothing ever held it — no implementer, no consumer, absent from every barrel. An
interface nobody holds does not change what any module depends on, so the number it was added to move
could not have moved either. Its README section now records that, and keeps the reasoning that
rejects chasing the metric in the first place.

`server/adapter/express.ts`, `fastify.ts` and `hono.ts` were byte-identical below their docblocks:
two imports and a one-line delegation each, with no framework type imported or adapted anywhere. They
are replaced by a single `server/adapter/index.ts` whose docblock says what the function actually
returns — a route descriptor the host binds itself, not middleware. The three per-framework docblocks
claimed an adaptation that did not exist, which is the half of this that could mislead a reader.

Their three test files, which had quietly drifted into three different levels of coverage, are one
file carrying the union of their cases plus one new case asserting the descriptor contract directly.
