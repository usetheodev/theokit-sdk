---
"@theokit/sdk-budget": patch
"@theokit/sdk-handoff": patch
"@theokit/sdk-memory": patch
---

The declared `@theokit/sdk` peer ranges stop promising versions the packages do not compile against.

All three declared `>=4.0.0`. `4.0.1` is the lowest published version that range admits — what a
consumer pinning conservatively, or resolving under an older transitive constraint, lands on. npm
resolves the combination with no `ERESOLVE` and no peer warning, and the build then fails on
`TS2552: Cannot find name` and `TS2305: has no exported member`.

The floors were measured by bisecting the 116 stable 4.x releases with a real build as the oracle.
Each one has its immediately preceding version failing, so these are exact versions rather than
intervals:

| package | floor | evidence |
|---|---|---|
| `@theokit/sdk-budget` | `>=4.54.0` | `4.53.1` fails, `4.54.0` passes |
| `@theokit/sdk-handoff` | `>=4.54.0` | `4.53.1` fails, `4.54.0` passes |
| `@theokit/sdk-memory` | `>=4.53.1` | `4.53.0` fails, `4.53.1` passes |

`sdk-memory` sits one release below the other two: this is not one shared migration, it is three
packages that each drifted past their own declared floor.

The oracle deletes every `dist/` before building. Without that the build reads a sibling's output
compiled against a different version, which is how a package "passes" against an SDK missing its
symbols — the failure mode that made the earlier measurement disagree with CI
(usetheokit/theokit-sdk#423).
