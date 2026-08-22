---
"@theokit/sdk": patch
---

A model id could stall the process for minutes. The Anthropic price lookup normalised dots with
`/(\d+)\.(\d+)/g`, which on a long run of digits containing no dot consumes to the end of the
string at every start position and backtracks — quadratic in a value the caller supplies.

Measured: 12,500 digits took 762 ms; 25,000 took 3 seconds; 200,000 took **154 seconds** with one
CPU pinned. For an SDK built to run inside a server handling other people's requests, that is a
denial of service reachable from a single field.

The same input now takes about 4 milliseconds. The pattern matches one dot between two digits
using lookarounds, so there is nothing for the engine to backtrack over.

One behaviour difference, and it is checked rather than assumed: a model id with two dots between
digits (`1.2.3`) normalised to `1-2.3` before and `1-2-3` now, because the old pattern swallowed
the middle digit into its first match. No id in the provider catalog has two — measured across all
34, of which 14 have exactly one.

Separately, reading a transcript's tail called `statSync(path)` and then `openSync(path)`, and the
size from the first call drove every read offset against the descriptor from the second. It now
sizes the descriptor it reads.
