---
"@theokit/sdk": patch
---

Correct a version number in the 5.1.0 release notes

The 5.1.0 entry *"Snapshot versions now sort ABOVE the release they are cut from"* illustrates the
result as `5.0.2-compat-580-…`. **That digit was invented rather than derived.** The pending
changesets included a `minor`, so the calculated base was `5.1.0`, and the first cut after the change
printed:

```
5.1.0-compat-581-20260905211819
```

A correction was written before the release and did not reach it: it lived in a pull request that had
not merged when `changeset version` consumed the changeset, so the uncorrected text shipped.

Recorded as a new entry rather than by editing the published one, per this project's changelog
discipline — a released entry is a record of what was said at the time, and rewriting it hides that
the correction happened.

**Why a wrong digit was worth two entries:** the property that mattered — sorting above `5.0.0` —
held with either number. An invented value that does not change the conclusion is the kind that stays
uncorrected forever, and a reader comparing the changelog against what they installed would have
found an unexplained discrepancy and rightly concluded one of the two was lying.
