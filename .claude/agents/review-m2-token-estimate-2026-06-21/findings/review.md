# review (combined) — m2-token-estimate
Verdict: 0 BLOCKER, 0 HIGH (all INFO). 30/30 green, typecheck OK, biome clean.
- INFO: estimateTokens=ceil(len/4) verified (""→0, " "/"ab"→1, "12345678"→2); shouldCompact `estimated >= contextWindow - buffer` boundary `>=` correct (D2). No throw path (pure arithmetic).
- INFO: M2-1 helpers unchanged (purely additive); 6 new unit cases non-vacuous + EC-1 covered; wiring test asserts the 2 symbols importable from the subpath.
- INFO: ADRs D1/D2/D3 honored; Coverage Matrix 8/8; zero new deps (no tokenizer); changeset @theokit/sdk:minor correct; docs/CHANGELOG honest (heuristic, decoupled via param); EC-2 documented in JSDoc.
- INFO: SRP/cohesion clean; complexity CC=1; file 128 LoC; contextWindow is a param (decoupled from M2-4 catalog). No scope creep.
