---
"@theokit/sdk": patch
---

Label the cloud-only surfaces as pre-release in `docs.md` (M7). The README already
carried a "Cloud runtime — pre-release" banner; `docs.md` (the canonical API
contract) only labeled artifacts. It now carries an explicit cloud pre-release
banner in the Overview and inline "cloud-only, pre-release" labels on `cloud.envVars`,
`cloud.autoCreatePR`, and `result.git` — matching the SDK's pre-release-honesty
contract (cloud depends on Theo PaaS, currently pre-release; every cloud API
describes the contract for when PaaS reaches GA, validated by the SDK's cloud
contract/golden tests against a stub, not a live endpoint). No API or behavior
change; no GA claim. Also fixed a teardown race in the cloud runtime contract test
(dispose flushes the fire-and-forget session appends before the temp workspace is
removed, so `rm(recursive)` no longer races an in-flight write into `ENOTEMPTY`).
