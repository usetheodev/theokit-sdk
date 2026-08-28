---
"@theokit/sdk": minor
---

Memory recall is scored with BM25 instead of Jaccard, and rank fusion is damped for stores of
tens rather than hundreds.

**What changes for you:** which memories are selected when several are plausible. The store, the
budget and the API are unchanged; the ordering is not.

Measured on LongMemEval-S — 500 questions, 54 sessions each — through a public eval harness, with
its tokenised-substring `grep` adapter as the floor:

| | hit@5 | P@5 | R@5 | p50 |
|---|---|---|---|---|
| Jaccard (4.61.0) | 80.0% | 0.236 | 0.670 | 205ms |
| `grep` (floor) | 89.0% | 0.295 | 0.807 | 2ms |
| **BM25 (this release)** | **96.8%** | **0.329** | **0.904** | **20ms** |

Jaccard lost to a naive substring match. The mechanism was isolated before it was fixed: on a
preference query, the term that discriminates appeared in 2 of 15 documents while a noise term
appeared in 14 — and Jaccard weighted them identically. Almost every document scored above zero,
fusion flattened what ordering remained, and recency decided a relevance question. IDF is the
whole fix, and the gain concentrates where that predicts:

```
single-session-preference   46.7% -> 86.7%   (+40.0)
single-session-assistant    89.3% -> 100.0%  (+10.7)
temporal-reasoning          85.7% ->  96.2%  (+10.5)
multi-session               94.7% ->  96.2%   (+1.5)
```

Also **10x faster**: the previous implementation called its scoring function from inside sort
comparators, re-tokenising every fact O(n log n) times per query.

Rank fusion damping moves from k = 60 to k = 5. Swept rather than chosen — the 500-question corpus
is insensitive to k once terms are IDF-weighted, while a 15-session corpus goes from 14/15 to
15/15. The sweep cannot separate 5 from 1, so the tie is broken on the principle that at k = 1
damping is nearly gone and fusion stops fusing.

**This improves the reliability of memory poisoning as well as of recall**, and the two cannot be
separated: the property that makes a planted entry work is the property that makes a real one
useful. See the accompanying patch note for the re-measured figures.
