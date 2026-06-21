# architecture + wiring — m3-rich-errors
Verdict: 0 BLOCKER, 0 HIGH. biome clean, knip exit 0, 12/12.
- INFO: object-literal-over-defineTool is the CORRECT DIP-preserving choice (inputSchema is already JSON Schema; defineTool would double-convert). Contract faithfully preserved.
- INFO: SRP/cohesion/placement clean (internal/, 81 LoC, complexity ≤10); DIP type-only CustomTool import; KISS/YAGNI good.
- LOW: knip non-probative for sdk-tools (not a workspace); wiring evidence is the real-tool integration test + LEGO precedent (sufficient).
