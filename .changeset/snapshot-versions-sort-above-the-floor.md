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
would produce, so the same cut becomes `5.0.2-compat-580-…`: still a prerelease, still off `latest`,
still never resolved by a caret range — and now correctly ordered against the floor.

Reported by the `theocode` session, which caught it in the only way it was catchable: its first run
piped the output through `tail -3`, which cut the warning off, and the second kept the whole thing.
