---
"@theokit/sdk": patch
---

SE3 — close the message-origin provenance gaps found by adversarial review. The SDK now actually STAMPS origin on the delegation and continuation paths (previously declared-but-unproduced union members): a delegated subagent's turn carries `{ kind: "coordinator" }`, and the run-to-completion / stream-to-completion driver's continuation rounds carry `{ kind: "auto-continuation" }`. `peer` (Squad / a2a) was already produced; `human` and `task-notification` remain host-supplied positive markers (documented). Metadata-only — never changes routing.
