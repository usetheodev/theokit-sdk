---
"@theokit/sdk": patch
---

Fix a leaked timeout timer in `MessageBus.request` (a2a). The request raced the handler against a `setTimeout`, but never cleared the timer when the handler won — a successful request left a live 30s timer that kept the Node event loop alive, so a process hung after the reply. The timer is now cleared in a `finally`.
