---
"@theokit/sdk": patch
---

SE17 gap closure — make the `toModelOutput` model-vs-app tool-output split REAL end-to-end. Previously the transform was applied inside the tool handler, so `onToolEnd` observability only ever saw the compact model-facing value — the application lost the full result (DoD 2/5 unmet). Now a `toModelOutput` tool carries a split resolver: the MODEL's `tool_result` receives the compact representation while `onToolEnd.result` receives the FULL raw handler output (serialized), from ONE handler execution. Direct `tool.handler()` calls still return the model-facing value (back-compat). Metadata/observability-only; no routing change.
