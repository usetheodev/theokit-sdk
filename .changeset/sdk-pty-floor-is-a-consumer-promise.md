---
"@theokit/sdk-pty": patch
---

Raises the `@theokit/sdk` peer floor from `>=4.4.1` to `>=4.54.0`.

This range **passed** the CI leg that builds each package against its own floor, and that is what
makes it worth recording. `sdk-pty`'s build does not typecheck the SDK's declarations, so a broken
`.d.ts` never reaches its compiler. A consumer's does.

Measured across the 4.x line with `skipLibCheck: false` and `@types/node` + `zod` installed —
the environment a real consumer has:

| version | errors inside the SDK's own `.d.ts` |
|---|---|
| 4.4.1 | 6 |
| 4.19.3 | 7 |
| 4.53.1 | 7 |
| **4.54.0** | **0** |

4.54.0 is the first version a TypeScript consumer can compile against at all (#335 / #345 / #348).
The old floor was true about this repository's build and false about the consumers the field exists
to inform — and where those disagree, the consumer's answer is the one a peer range is making a
claim about.
