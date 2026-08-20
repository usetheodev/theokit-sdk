---
"@theokit/memory-honcho": patch
"@theokit/memory-mem0": patch
---

Two adapters could not work against the real vendor APIs. Both bugs were invisible to their existing
tests, because those tests replaced the vendor SDK with a hand-written mock and asserted against the
mock's shape rather than the vendor's.

**The Honcho adapter could not talk to a Honcho server at all.** It built session identifiers as
`userId:session`, and the vendor SDK's schema rejects every character outside letters, digits,
underscore and hyphen — a colon is illegal. Every `write()` and every `recall()` raised a validation
error before a single HTTP request left the process. The separator is now `--`. No migration is
needed and none is possible: because the old identifier was rejected at the boundary, no session was
ever created under it.

**The Mem0 adapter misclassified every vendor error.** It read `status` and `statusCode` off thrown
errors; the vendor sets neither, carrying the code as `errorCode: "HTTP_429"` instead. So every real
failure fell through to an unknown classification — rate limits never received the rate-limit
exemption, and server errors never counted toward the circuit breaker, which is precisely the
protection those classifications exist to provide. The status is now derived from the vendor's own
field as well.

The reason neither surfaced earlier is worth stating: the existing test mocked the vendor and
fabricated a `status` property on thrown errors — a value the real library never produces. The test
asserted the adapter reads a field the mock invented.

All three cloud memory adapters now carry a recorded-wire contract test that pins the actual request
put on the wire and the vendor response shape it must survive, plus a live smoke that runs when a
vendor key is present and reports itself as skipped, with the reason, when one is not.
