---
"@theokit/sdk": patch
---

Snapshot versions now sort ABOVE the release they are cut from

`changeset version --snapshot` defaults to a `0.0.0-` base, so every snapshot this repository has
ever published was `0.0.0-<tag>-<timestamp>` — which **sorts below every real release**, because
semver compares `major.minor.patch` numerically before it looks at a prerelease suffix.

Any consumer with a version floor therefore read a snapshot as older than the release it was cut
from. Measured by the `theokit/agents` layer against `0.0.0-compat-580-20260905204608`, on every
run:

```
`compatSources` was declared, but @theokit/sdk@0.0.0-compat-580-… does not know that option and
will ignore it — the foreign configuration root will NOT be read. It landed in 5.0.0.
```

The code in that snapshot knew the option perfectly well. **The version number said it did not, so
the feature was switched off** — silently for anyone not reading stderr, and precisely the feature
the snapshot existed to deliver.

`snapshot.useCalculatedVersion: true` bases the snapshot on the version the pending changesets
would produce. Measured on the first cut after the change: `5.1.0-compat-581-20260905211819` — still
a prerelease, still off `latest`, still never resolved by a caret range, and now correctly ordered
against the floor.

(An earlier draft of this entry illustrated the result as `5.0.2-…`. That digit was invented rather
than derived: the pending changesets include a `minor`, so the calculated base is `5.1.0`. The number
above is the one the publish actually printed.)

Reported by the `theocode` session, which caught it in the only way it was catchable: its first run
piped the output through `tail -3`, which cut the warning off, and the second kept the whole thing.
