# architecture + wiring — m3-repo-map
Verdict (initial): 0 BLOCKER, 1 HIGH. Tools: biome clean, knip exit 0, 13/13.
- INFO: SRP/cohesion/placement clean (internal/, 162 LoC); DIP node:fs/path only; complexity ≤10; KISS/YAGNI good.
- HIGH → FIXED (ad2a68a): plan DoD/AC claimed "knip reports 0 unused exports for the builders" but sdk-tools is NOT a configured knip workspace → claim vacuous. The export itself is acceptable (formatCode LEGO precedent; no-stubs §3 scoped to packages/sdk/src). Fixed DoD wording to cite the barrel test + LEGO precedent + M8-2 driver instead of knip.
- LOW: budget newline under-count by ≤1/line (harmless, conservative).
